import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceTab, WorkspaceTabContext } from "../mirador/api.ts";
import { authArgs, countArgs, countOf, createdKeyOf, FILE, listArgs, problemOf, projectArgs, sprintsArgs, undoAction, viewArgs, writePlan } from "./acli.ts";
import { branchesArgs, candidatesOf, commitsArgs } from "./detect.ts";
import { allViews, BUILT_IN_VIEWS, filterProblem, projectOf, sourceJql, viewJql } from "./jql.ts";
import {
  DEFAULT_PREFS,
  type AcliProblem,
  type Candidate,
  type Connection,
  type DetailResult,
  type Issue,
  type IssueType,
  type ListResult,
  type Me,
  type Person,
  type Prefs,
  type ProjectLookup,
  type SavedView,
  type Source,
  type Sprint,
  type Status,
  type TabAction,
  type TabState,
  type Undo,
  type WriteAction,
  type WriteReply,
} from "./model.ts";
import { authOf, detailOf, issueOf, type RawIssue } from "./normalize.ts";
import { promptLevelOf, PROMPTS, withPrompt, type PromptOverrides } from "./prompts.ts";
import { ProgramMissing, spawnRunner, type Ran, type Runner } from "./run.ts";

/** Each list and detail is read at most this often, however many views ask: every read is a call to the company's Jira. */
export const MIN_READ_GAP_MS = 5000;
export const TIMER_READ_GAP_MS = 90_000;
export const MIN_COUNTS_GAP_MS = 60_000;
/** acli calls running at once, across workspaces. */
export const MOST_AT_ONCE = 3;
const KEPT_LISTS = 12;
const KEPT_DETAILS = 30;

/** Problems that keep acli from answering anything, which the whole tab shows. */
const BLOCKING: AcliProblem["code"][] = ["not-installed", "not-signed-in"];

interface ProjectMeta {
  name: string;
  issueTypes: IssueType[];
  components: string[];
}

interface WorkspaceCache {
  candidates: Candidate[] | undefined;
  problem: AcliProblem | null;
  me: Me | null;
  /** By project key. */
  metas: Map<string, ProjectMeta>;
  lists: Map<string, ListResult>;
  counts: Record<string, number>;
  details: Map<string, DetailResult>;
  readAt: Map<string, number>;
  /** By project key, then status name. */
  statuses: Map<string, Map<string, Status>>;
  people: Map<string, Person>;
  sprints: Map<number, Sprint>;
  loading: Set<string>;
  fetching: Map<string, Promise<unknown>>;
}

const emptyCache = (): WorkspaceCache => ({
  candidates: undefined,
  problem: null,
  me: null,
  metas: new Map(),
  lists: new Map(),
  counts: {},
  details: new Map(),
  readAt: new Map(),
  statuses: new Map(),
  people: new Map(),
  sprints: new Map(),
  loading: new Set(),
  fetching: new Map(),
});

const keepNewest = <Value>(map: Map<string, Value>, key: string, value: Value, most: number) => {
  map.delete(key);
  map.set(key, value);
  while (map.size > most) map.delete(map.keys().next().value!);
};

class AcliFailed extends Error {
  constructor(readonly problem: AcliProblem) {
    super(problem.message);
  }
}

const isSource = (value: unknown): value is Source =>
  !!value && typeof value === "object" && ["name", "project", "projectName", "filter"].every((key) => typeof (value as Record<string, unknown>)[key] === "string");

/** A stored connection, from before sources too, which had none. */
const connectionFrom = (value: unknown): Connection | null => {
  if (!value || typeof value !== "object") return null;
  const stored = value as Record<string, unknown>;
  if (!["site", "project", "projectName"].every((key) => typeof stored[key] === "string")) return null;
  const sources = Array.isArray(stored.sources) ? stored.sources.filter(isSource) : [];
  return { site: stored.site as string, project: stored.project as string, projectName: stored.projectName as string, sources };
};

const byCategory = (statuses: Iterable<Status>) => [...statuses].sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]);

const promptsOf = (context: WorkspaceTabContext): PromptOverrides => ({ workspace: promptLevelOf(context.storage.get("prompts")), every: promptLevelOf(context.sharedStorage.get("prompts")) });

const prefsOf = (value: unknown): Prefs => ({ ...DEFAULT_PREFS, ...(value && typeof value === "object" ? (value as Partial<Prefs>) : {}) });

const savedViewsOf = (value: unknown): SavedView[] => (Array.isArray(value) ? value.filter((view): view is SavedView => typeof view?.name === "string" && typeof view?.jql === "string") : []);

const CATEGORY_ORDER = { new: 0, indeterminate: 1, done: 2 } as const;
const SPRINT_ORDER = { active: 0, future: 1, closed: 2 } as const;

/** One at a time past MOST_AT_ONCE, so a burst of reads doesn't hit Jira all at once. */
class Gate {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  async through<Result>(work: () => Promise<Result>): Promise<Result> {
    if (this.running >= MOST_AT_ONCE) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running += 1;
    try {
      return await work();
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }
}

/** The Jira tab of every workspace: what Mirador asks of it, and the user's actions in it. */
export class JiraTab implements WorkspaceTab<TabState> {
  private readonly caches = new Map<string, WorkspaceCache>();
  private readonly namesKeys = new Map<string, boolean>();
  private readonly gate = new Gate();

  constructor(
    private readonly run: Runner = spawnRunner,
    private readonly now: () => number = Date.now,
  ) {}

  private cacheOf(context: WorkspaceTabContext) {
    const known = this.caches.get(context.workspace.id);
    if (known) return known;
    const cache = emptyCache();
    this.caches.set(context.workspace.id, cache);
    return cache;
  }

  private connectionOf(context: WorkspaceTabContext): Connection | null {
    return connectionFrom(context.storage.get("connection"));
  }

  /** Connected, or a git folder whose history names issue keys: other folders don't get a Jira tab. */
  async shows(context: WorkspaceTabContext) {
    if (this.connectionOf(context)) return true;
    const folder = context.workspace.folder;
    if (!this.namesKeys.has(folder)) this.namesKeys.set(folder, (await this.candidatesIn(folder)).length > 0);
    return this.namesKeys.get(folder)!;
  }

  async state(context: WorkspaceTabContext): Promise<TabState> {
    const cache = this.cacheOf(context);
    const connection = this.connectionOf(context);
    if (!connection && cache.candidates === undefined) cache.candidates = await this.candidatesIn(context.workspace.folder);
    return {
      connection,
      candidates: cache.candidates ?? [],
      problem: cache.problem,
      me: cache.me,
      lists: Object.fromEntries(cache.lists),
      counts: cache.counts,
      details: Object.fromEntries(cache.details),
      statuses: Object.fromEntries([...cache.statuses].map(([project, statuses]) => [project, byCategory(statuses.values())])),
      people: [...cache.people.values()].sort((a, b) => a.name.localeCompare(b.name)),
      sprints: [...cache.sprints.values()].sort((a, b) => SPRINT_ORDER[a.state] - SPRINT_ORDER[b.state] || (a.endDate ?? "").localeCompare(b.endDate ?? "")),
      issueTypes: Object.fromEntries([...cache.metas].map(([project, meta]) => [project, meta.issueTypes])),
      savedViews: savedViewsOf(context.storage.get("savedViews")),
      prefs: prefsOf(context.storage.get("prefs")),
      prompts: promptsOf(context),
      loading: [...cache.loading],
    };
  }

  async action(action: unknown, context: WorkspaceTabContext): Promise<unknown> {
    const asked = action as TabAction;
    switch (asked.kind) {
      case "connect":
        return this.connect(context, asked.project);
      case "disconnect":
        context.storage.set("connection", undefined);
        this.caches.set(context.workspace.id, emptyCache());
        context.changed();
        return null;
      case "refresh":
        await this.refresh(context, asked.jql, asked.counts, asked.by === "timer" ? TIMER_READ_GAP_MS : MIN_READ_GAP_MS, asked.force ?? false);
        return null;
      case "open":
        await this.fetchDetail(context, asked.key);
        return null;
      case "set-prompt": {
        if (!(asked.prompt in PROMPTS)) throw new Error(`The Jira tab has no message ${JSON.stringify(asked.prompt)}.`);
        const storage = asked.scope === "every" ? context.sharedStorage : context.storage;
        storage.set("prompts", withPrompt(promptsOf(context), asked.scope, asked.prompt, asked.text));
        context.changed();
        return null;
      }
      case "prefs":
        context.storage.set("prefs", prefsOf(asked.prefs));
        context.changed();
        return null;
      case "save-view":
        return this.saveView(context, asked.name, asked.jql);
      case "remove-view":
        context.storage.set("savedViews", savedViewsOf(context.storage.get("savedViews")).filter(({ name }) => name !== asked.name));
        context.changed();
        return null;
      case "find-sprints":
        await this.findSprints(context);
        return null;
      case "undo":
        return this.undo(context, asked.undo);
      case "look-up-project":
        return this.lookUpProject(context, asked.project);
      case "add-source":
        return this.addSource(context, asked.name, asked.project, asked.filter);
      case "remove-source": {
        const connection = this.connected(context);
        context.storage.set("connection", { ...connection, sources: connection.sources.filter(({ name }) => name !== asked.name) } satisfies Connection);
        this.cacheOf(context).counts = {};
        context.changed();
        void this.fetchCounts(context, true).catch(() => {});
        return null;
      }
      case "transition":
      case "assign":
      case "labels":
      case "comment":
      case "summary":
      case "description":
      case "create":
        return this.write(context, asked);
      default:
        throw new Error(`The Jira tab doesn't know the action ${JSON.stringify((asked as { kind?: unknown }).kind)}.`);
    }
  }

  private async candidatesIn(folder: string): Promise<Candidate[]> {
    const git = async (args: string[]) => {
      try {
        const ran = await this.run("git", args, { cwd: folder });
        return ran.code === 0 ? ran.stdout : "";
      } catch {
        return "";
      }
    };
    const [commits, branches] = await Promise.all([git(commitsArgs()), git(branchesArgs())]);
    return candidatesOf(commits, branches);
  }

  /** Runs acli in the workspace; a problem that blocks every call is the tab's until a call works. */
  private async acli(context: WorkspaceTabContext, args: string[]): Promise<string> {
    const cache = this.cacheOf(context);
    let ran: Ran;
    try {
      ran = await this.gate.through(() => this.run("acli", args, { cwd: context.workspace.folder }));
    } catch (error) {
      if (!(error instanceof ProgramMissing)) throw error;
      cache.problem = problemOf(error);
      context.changed();
      throw new AcliFailed(cache.problem);
    }
    if (ran.code !== 0) {
      const problem = problemOf(ran);
      if (BLOCKING.includes(problem.code)) {
        cache.problem = problem;
        context.changed();
      }
      throw new AcliFailed(problem);
    }
    if (cache.problem) {
      cache.problem = null;
      context.changed();
    }
    return ran.stdout;
  }

  private async acliJson<Shape>(context: WorkspaceTabContext, args: string[]): Promise<Shape> {
    return JSON.parse(await this.acli(context, args)) as Shape;
  }

  /**
   * One read per key at a time, and none again before the gap passes unless a write asks. A forced read waits for one
   * already running and then reads again, as that one may have started before the change it must see.
   */
  private async once(context: WorkspaceTabContext, key: string, fetch: () => Promise<void>, { gap = MIN_READ_GAP_MS, force = false } = {}): Promise<void> {
    const cache = this.cacheOf(context);
    const running = cache.fetching.get(key);
    if (running && !force) return running as Promise<void>;
    if (running) await running.catch(() => {});
    if (cache.fetching.has(key)) return cache.fetching.get(key) as Promise<void>;
    if (!force && this.now() - (cache.readAt.get(key) ?? -Infinity) < gap) return Promise.resolve();
    cache.loading.add(key);
    context.changed();
    const fetching = fetch().finally(() => {
      cache.readAt.set(key, this.now());
      cache.fetching.delete(key);
      cache.loading.delete(key);
      context.changed();
    });
    cache.fetching.set(key, fetching);
    return fetching;
  }

  private connected(context: WorkspaceTabContext) {
    const connection = this.connectionOf(context);
    if (!connection) throw new Error("Connect the workspace to a Jira project first.");
    return connection;
  }

  private async whoAmI(context: WorkspaceTabContext) {
    const auth = authOf(await this.acli(context, authArgs()));
    if (!auth) {
      const cache = this.cacheOf(context);
      cache.problem = { code: "not-signed-in", message: "acli isn't signed in to Jira." };
      throw new AcliFailed(cache.problem);
    }
    return auth;
  }

  private async connect(context: WorkspaceTabContext, typed: string) {
    const project = typed.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(project)) throw new Error(`"${typed}" isn't a Jira project key: it's the letters before the dash in an issue's key, like KITE in KITE-12.`);
    const cache = emptyCache();
    this.caches.set(context.workspace.id, cache);
    const auth = await this.whoAmI(context);
    let meta: ProjectMeta;
    try {
      meta = await this.fetchMeta(context, project);
    } catch (error) {
      if (!(error instanceof AcliFailed)) throw error;
      if (BLOCKING.includes(error.problem.code)) throw new Error(error.problem.message);
      throw new Error(`Jira has no project ${project} on ${auth.site.replace(/^https:\/\//, "")} that your account can see. acli said: ${error.problem.message}`);
    }
    cache.metas.set(project, meta);
    cache.me = { email: auth.email, accountId: null };
    context.storage.set("connection", { site: auth.site, project, projectName: meta.name, sources: [] } satisfies Connection);
    context.changed();
    return { connected: project };
  }

  private async fetchMeta(context: WorkspaceTabContext, project: string): Promise<ProjectMeta> {
    const about = await this.acliJson<Record<string, unknown>>(context, projectArgs(project));
    const named = (list: unknown) => (Array.isArray(list) ? (list as Record<string, unknown>[]) : []).filter(({ name }) => typeof name === "string");
    return {
      name: typeof about.name === "string" ? about.name : project,
      issueTypes: named(about.issueTypes).map(({ name, subtask }) => ({ name: name as string, subtask: subtask === true })),
      components: named(about.components)
        .map(({ name }) => name as string)
        .sort((a, b) => a.localeCompare(b)),
    };
  }

  /** A project's name and components, for adding it as a source; its issue types join New's picker. */
  private async lookUpProject(context: WorkspaceTabContext, typed: string): Promise<ProjectLookup> {
    const connection = this.connected(context);
    const project = typed.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(project)) throw new Error(`"${typed}" isn't a Jira project key: it's the letters before the dash in an issue's key.`);
    try {
      const meta = await this.fetchMeta(context, project);
      this.cacheOf(context).metas.set(project, meta);
      return { project, name: meta.name, components: meta.components };
    } catch (error) {
      if (!(error instanceof AcliFailed)) throw error;
      if (BLOCKING.includes(error.problem.code)) throw new Error(error.problem.message);
      throw new Error(`Jira has no project ${project} on ${connection.site.replace(/^https:\/\//, "")} that your account can see.`);
    }
  }

  /** Adds a source once Jira reads its filter, so a typo shows now in Jira's words, not later as an empty view. */
  private async addSource(context: WorkspaceTabContext, typedName: string, typedProject: string, typedFilter: string) {
    const connection = this.connected(context);
    const name = typedName.trim();
    const filter = typedFilter.trim();
    if (!name) throw new Error("Give the source's view a name.");
    const taken = [...BUILT_IN_VIEWS.map((view) => view.name), ...connection.sources.map((source) => source.name), ...savedViewsOf(context.storage.get("savedViews")).map((view) => view.name)];
    if (taken.some((each) => each.toLowerCase() === name.toLowerCase())) throw new Error(`There's a view called "${name}" already; pick another name.`);
    const problem = filterProblem(filter);
    if (problem) throw new Error(problem);
    const { project, name: projectName } = await this.lookUpProject(context, typedProject);
    const source: Source = { name, project, projectName, filter };
    let found: number | null;
    try {
      found = countOf(await this.acli(context, countArgs(sourceJql({ project, filter }))));
    } catch (error) {
      if (error instanceof AcliFailed) throw new Error(`Jira can't read that filter: ${error.problem.message}`);
      throw error;
    }
    context.storage.set("connection", { ...connection, sources: [...connection.sources, source] } satisfies Connection);
    this.cacheOf(context).counts = {};
    context.changed();
    void this.fetchCounts(context, true).catch(() => {});
    return { added: name, found };
  }

  /**
   * The list a view shows, the views' counts when asked, and who the user is and what the project has, once. Recent is read
   * once too, as the statuses and people it holds fill the pickers: Jira can't be asked an issue's transitions.
   */
  private async refresh(context: WorkspaceTabContext, jql: string, counts: boolean, gap = MIN_READ_GAP_MS, force = false) {
    const connection = this.connected(context);
    const cache = this.cacheOf(context);
    const recent = viewJql("recent", connection, null, []);
    await Promise.allSettled([
      this.fetchList(context, jql, force, gap),
      counts && this.fetchCounts(context),
      jql !== recent && !cache.lists.has(recent) && this.fetchList(context, recent),
      !cache.me && this.once(context, "me", async () => void (cache.me = { email: (await this.whoAmI(context)).email, accountId: null })),
      ...[connection.project, ...connection.sources.map(({ project }) => project)]
        .filter((project) => !cache.metas.has(project))
        .map((project) => this.once(context, `meta:${project}`, async () => void cache.metas.set(project, await this.fetchMeta(context, project)))),
    ]);
  }

  private learn(context: WorkspaceTabContext, issues: Issue[], jql: string) {
    const cache = this.cacheOf(context);
    issues.forEach((issue) => {
      const project = projectOf(issue.key);
      if (!cache.statuses.has(project)) cache.statuses.set(project, new Map());
      cache.statuses.get(project)!.set(issue.status.name, issue.status);
      [issue.assignee, issue.reporter].forEach((person) => person && cache.people.set(person.accountId, person));
    });
    const me = cache.me;
    if (me && !me.accountId) {
      const byEmail = [...cache.people.values()].find((person) => me.email && person.email?.toLowerCase() === me.email.toLowerCase());
      const mine = /assignee\s*=\s*currentUser\(\)/i.test(jql) ? issues.find((issue) => issue.assignee)?.assignee : undefined;
      const accountId = byEmail?.accountId ?? mine?.accountId;
      if (accountId) cache.me = { ...me, accountId };
    }
  }

  private fetchList(context: WorkspaceTabContext, jql: string, force = false, gap = MIN_READ_GAP_MS) {
    const cache = this.cacheOf(context);
    return this.once(
      context,
      `list:${jql}`,
      async () => {
        const previous = cache.lists.get(jql);
        try {
          const rows = await this.acliJson<RawIssue[]>(context, listArgs(jql));
          const issues = (Array.isArray(rows) ? rows : []).flatMap((row) => issueOf(row) ?? []);
          this.learn(context, issues, jql);
          keepNewest(cache.lists, jql, { issues, fetchedAt: this.now(), problem: null }, KEPT_LISTS);
        } catch (error) {
          if (!(error instanceof AcliFailed)) throw error;
          keepNewest(cache.lists, jql, { issues: previous?.issues ?? [], fetchedAt: previous?.fetchedAt ?? null, problem: error.problem }, KEPT_LISTS);
        }
      },
      { force, gap },
    );
  }

  private fetchCounts(context: WorkspaceTabContext, force = false) {
    const connection = this.connected(context);
    const cache = this.cacheOf(context);
    const prefs = prefsOf(context.storage.get("prefs"));
    const saved = savedViewsOf(context.storage.get("savedViews"));
    const queries = allViews(connection, saved).map(({ id }) => viewJql(id, connection, prefs.sprint, saved));
    return this.once(
      context,
      "counts",
      async () => {
        await Promise.allSettled(
          queries.map(async (jql) => {
            const found = countOf(await this.acli(context, countArgs(jql)));
            if (found !== null) cache.counts[jql] = found;
          }),
        );
      },
      { gap: MIN_COUNTS_GAP_MS, force },
    );
  }

  private fetchDetail(context: WorkspaceTabContext, key: string, force = false) {
    this.connected(context);
    const cache = this.cacheOf(context);
    return this.once(
      context,
      `detail:${key}`,
      async () => {
        const previous = cache.details.get(key);
        try {
          const detail = detailOf(await this.acliJson<RawIssue>(context, viewArgs(key)));
          if (detail) {
            this.learn(context, [detail], "");
            detail.comments.forEach(({ author }) => author && cache.people.set(author.accountId, author));
            detail.sprints.forEach((sprint) => cache.sprints.set(sprint.id, sprint));
            this.replaceInLists(context, detail);
          }
          keepNewest(cache.details, key, { detail, fetchedAt: this.now(), problem: detail ? null : { code: "not-found", message: `Jira has no issue ${key}.` } }, KEPT_DETAILS);
        } catch (error) {
          if (!(error instanceof AcliFailed)) throw error;
          keepNewest(cache.details, key, { detail: previous?.detail ?? null, fetchedAt: previous?.fetchedAt ?? null, problem: error.problem }, KEPT_DETAILS);
        }
      },
      { force },
    );
  }

  /** The lists show an issue as its latest read has it. */
  private replaceInLists(context: WorkspaceTabContext, issue: Issue) {
    const { key, summary, type, subtask, status, priority, assignee, reporter, labels } = issue;
    for (const list of this.cacheOf(context).lists.values()) {
      const index = list.issues.findIndex((each) => each.key === key);
      if (index >= 0) list.issues[index] = { key, summary, type, subtask, status, priority, assignee, reporter, labels };
    }
  }

  /** The open sprints the user's issues are in, and the others on those boards, with the active one picked once. */
  private async findSprints(context: WorkspaceTabContext) {
    const connection = this.connected(context);
    const cache = this.cacheOf(context);
    await this.once(
      context,
      "sprints",
      async () => {
        const jql = `project = ${connection.project} AND assignee = currentUser() AND sprint in openSprints() ORDER BY updated DESC`;
        const mine = await this.acliJson<RawIssue[]>(context, listArgs(jql)).catch(() => []);
        const first = (Array.isArray(mine) ? mine : []).flatMap((row) => issueOf(row) ?? [])[0];
        if (first) await this.fetchDetail(context, first.key);
        const boards = new Set([...cache.sprints.values()].filter(({ state }) => state !== "closed").flatMap(({ boardId }) => (boardId === null ? [] : [boardId])));
        await Promise.allSettled(
          [...boards].map(async (board) => {
            const answer = await this.acliJson<{ sprints?: unknown[]; values?: unknown[] }>(context, sprintsArgs(board));
            (answer.sprints ?? answer.values ?? []).forEach((value) => {
              const sprint = value as Record<string, unknown>;
              const state = sprint.state as Sprint["state"];
              if (typeof sprint.id === "number" && (state === "active" || state === "future"))
                cache.sprints.set(sprint.id, { id: sprint.id, name: String(sprint.name ?? `Sprint ${sprint.id}`), state, boardId: board, endDate: typeof sprint.endDate === "string" ? sprint.endDate : null });
            });
          }),
        );
        const prefs = prefsOf(context.storage.get("prefs"));
        const active = [...cache.sprints.values()].find(({ state }) => state === "active");
        if (prefs.sprint === null && active) context.storage.set("prefs", { ...prefs, sprint: active.id });
      },
      { gap: MIN_COUNTS_GAP_MS },
    );
  }

  private saveView(context: WorkspaceTabContext, name: string, jql: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Give the view a name.");
    if (BUILT_IN_VIEWS.some((view) => view.name.toLowerCase() === trimmed.toLowerCase())) throw new Error(`"${trimmed}" is one of the built-in views; pick another name.`);
    if (this.connectionOf(context)?.sources.some((source) => source.name.toLowerCase() === trimmed.toLowerCase())) throw new Error(`"${trimmed}" is a source's view; pick another name.`);
    const others = savedViewsOf(context.storage.get("savedViews")).filter((view) => view.name.toLowerCase() !== trimmed.toLowerCase());
    context.storage.set("savedViews", [...others, { name: trimmed, jql: jql.trim() }]);
    context.changed();
    return { saved: trimmed };
  }

  /** The issue as the tab last read it: opened, or in a list. */
  private issueNow(context: WorkspaceTabContext, key: string): Issue | null {
    const cache = this.cacheOf(context);
    const detail = cache.details.get(key)?.detail;
    if (detail) return detail;
    for (const list of cache.lists.values()) {
      const found = list.issues.find((issue) => issue.key === key);
      if (found) return found;
    }
    return null;
  }

  private undoFor(context: WorkspaceTabContext, action: WriteAction): Undo | null {
    const issue = this.issueNow(context, "key" in action ? action.key : "");
    if (!issue) return null;
    switch (action.kind) {
      case "transition":
        return issue.status.name === action.status ? null : { kind: "status", key: action.key, from: issue.status.name, to: action.status };
      case "assign":
        return { kind: "assignee", key: action.key, from: issue.assignee, to: action.to };
      case "labels":
        return { kind: "labels", key: action.key, added: action.add.filter((label) => !issue.labels.includes(label)), removed: action.remove.filter((label) => issue.labels.includes(label)) };
      default:
        return null;
    }
  }

  /** Shows an edit made at once in the lists and the detail before Jira is read again. */
  private applyAtOnce(context: WorkspaceTabContext, action: WriteAction) {
    const cache = this.cacheOf(context);
    const change = (issue: Issue) => {
      if (action.kind === "transition") issue.status = cache.statuses.get(projectOf(issue.key))?.get(action.status) ?? { name: action.status, category: issue.status.category };
      if (action.kind === "assign") issue.assignee = action.to;
      if (action.kind === "labels") issue.labels = [...issue.labels.filter((label) => !action.remove.includes(label)), ...action.add.filter((label) => !issue.labels.includes(label))];
      if (action.kind === "summary") issue.summary = action.summary;
    };
    if (!("key" in action)) return;
    for (const list of cache.lists.values()) list.issues.filter(({ key }) => key === action.key).forEach(change);
    const detail = cache.details.get(action.key)?.detail;
    if (detail) change(detail);
    context.changed();
  }

  private async runWrite(context: WorkspaceTabContext, action: WriteAction): Promise<string> {
    const plan = writePlan(action, this.cacheOf(context).me?.accountId ?? null);
    const folder = plan.file ? await mkdtemp(join(tmpdir(), "mirador-jira-")) : null;
    try {
      const path = folder && plan.file ? join(folder, plan.file.name) : null;
      if (path && plan.file) await writeFile(path, plan.file.content);
      return await this.acli(
        context,
        plan.args.map((arg) => (arg === FILE ? path! : arg)),
      );
    } catch (error) {
      if (error instanceof AcliFailed) throw new Error(error.problem.message);
      throw error;
    } finally {
      if (folder) await rm(folder, { recursive: true, force: true });
    }
  }

  /** After a write: the issue as Jira has it now, the lists it may have moved in or out of, and the counts. */
  private async readAfterWrite(context: WorkspaceTabContext, key: string | null) {
    const cache = this.cacheOf(context);
    await Promise.allSettled([key && this.fetchDetail(context, key, true), ...[...cache.lists.keys()].map((jql) => this.fetchList(context, jql, true)), this.fetchCounts(context, true)]);
  }

  private async write(context: WorkspaceTabContext, action: WriteAction): Promise<WriteReply> {
    const connection = this.connected(context);
    if (action.kind === "transition" && !action.status.trim()) throw new Error("Pick a status.");
    const projects = [connection.project, ...connection.sources.map(({ project }) => project)];
    if (action.kind === "create" && !projects.includes(action.project)) throw new Error(`This workspace takes in ${projects.join(" and ")}, not ${action.project}.`);
    const undo = this.undoFor(context, action);
    const output = await this.runWrite(context, action);
    this.applyAtOnce(context, action);
    const created = action.kind === "create" ? createdKeyOf(output) : null;
    void this.readAfterWrite(context, "key" in action ? action.key : created);
    return { done: true, undo, ...(created && { key: created }) };
  }

  /** Puts a field back unless it changed since, so a teammate's later change stays. */
  private async undo(context: WorkspaceTabContext, undo: Undo): Promise<WriteReply> {
    this.connected(context);
    await this.fetchDetail(context, undo.key, true);
    const now = this.cacheOf(context).details.get(undo.key)?.detail;
    if (!now) throw new Error(`Jira didn't answer about ${undo.key}, so it's left as it is.`);
    const changedSince = () => new Error(`${undo.key} (${now.summary}) changed since, so Undo would overwrite someone else's change.`);
    if (undo.kind === "status" && now.status.name !== undo.to) throw changedSince();
    if (undo.kind === "assignee" && (now.assignee?.accountId ?? null) !== (undo.to?.accountId ?? null)) throw changedSince();
    const back = undoAction(undo);
    try {
      await this.runWrite(context, back);
    } catch (error) {
      if (undo.kind === "status") throw new Error(`Jira won't move ${undo.key} (${now.summary}) back to ${undo.from}: ${(error as Error).message}`);
      throw error;
    }
    this.applyAtOnce(context, back);
    void this.readAfterWrite(context, undo.key);
    return { done: true, undo: null };
  }
}
