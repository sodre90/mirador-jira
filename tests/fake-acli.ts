import { readFileSync } from "node:fs";
import type { Ran, Runner } from "../jira/run.ts";
import { DANA, ISSUE_TYPES, ISSUES, ME, PROJECT, SITE, SPRINT_7, SPRINT_8, STATUSES, WORKFLOW, type FakeIssue, type FakePerson } from "./fixtures/jira.ts";

/** What search lets through, as the real acli does: it refuses any other field. */
const SEARCH_FIELDS = new Set(["issuetype", "key", "summary", "status", "priority", "assignee", "reporter", "labels", "description"]);

const PEOPLE = [DANA, ...ISSUES.flatMap(({ assignee, reporter }) => [assignee, reporter]).filter((person): person is FakePerson => !!person)];

export interface FakeJiraState {
  issues: FakeIssue[];
  signedIn: boolean;
  nextKey: number;
  nextComment: number;
}

export const freshState = (): FakeJiraState => ({ issues: structuredClone(ISSUES), signedIn: true, nextKey: 431, nextComment: 10003 });

const ok = (stdout: string): Ran => ({ code: 0, stdout, stderr: "" });
const fail = (message: string): Ran => ({ code: 1, stdout: "", stderr: `✗ Error: ${message}\n` });

const statusJson = (status: FakeIssue["status"]) => ({ name: status.name, statusCategory: { key: status.category, name: status.name } });
const personJson = (person: FakePerson | null) => person && { accountId: person.accountId, displayName: person.displayName, emailAddress: person.emailAddress ?? undefined, active: true };
const typeJson = (type: string) => ({ name: type, subtask: type === "Sub-task" });

/** A Jira stand-in: the issues of the Kite project, the JQL the tab writes, and acli's commands and answers. */
export class FakeJira {
  readonly log: string[][] = [];

  constructor(readonly state: FakeJiraState = freshState()) {}

  readonly runner: Runner = async (program, args) => this.answer(program, args);

  calls = (...prefix: string[]) => this.log.filter((args) => prefix.every((word, index) => args[index] === word)).length;

  private issue = (key: string) => this.state.issues.find((issue) => issue.key === key);

  private brief(issue: FakeIssue) {
    return { key: issue.key, fields: { summary: issue.summary, status: statusJson(issue.status), issuetype: typeJson(issue.type), priority: { name: issue.priority } } };
  }

  private searchJson(issue: FakeIssue, fields: string[]) {
    const all: Record<string, unknown> = {
      summary: issue.summary,
      issuetype: typeJson(issue.type),
      status: statusJson(issue.status),
      priority: { name: issue.priority },
      assignee: personJson(issue.assignee),
      reporter: personJson(issue.reporter),
      labels: issue.labels,
      description: issue.description,
    };
    return { key: issue.key, fields: Object.fromEntries(fields.filter((field) => field in all).map((field) => [field, all[field]])) };
  }

  private viewJson(issue: FakeIssue) {
    const parent = issue.parent ? this.issue(issue.parent) : undefined;
    return {
      key: issue.key,
      fields: {
        ...this.searchJson(issue, [...SEARCH_FIELDS]).fields,
        created: issue.created,
        updated: issue.updated,
        resolution: issue.status.category === "done" ? { name: "Done" } : null,
        duedate: null,
        components: [],
        fixVersions: [],
        parent: parent ? this.brief(parent) : null,
        subtasks: this.state.issues.filter((each) => each.parent === issue.key && each.type === "Sub-task").map((each) => this.brief(each)),
        issuelinks: issue.links.flatMap((link) => {
          const other = this.issue(link.to);
          if (!other) return [];
          const type = { name: link.type, inward: link.inward, outward: link.outward };
          return [link.outwardFromHere ? { type, outwardIssue: this.brief(other) } : { type, inwardIssue: this.brief(other) }];
        }),
        comment: { comments: issue.comments, total: issue.comments.length, maxResults: 50, startAt: 0 },
        customfield_10020: issue.sprint ? [issue.sprint === SPRINT_7.id ? SPRINT_7 : SPRINT_8] : null,
        customfield_10016: 3,
      },
    };
  }

  /** The JQL the tab writes: clauses joined by AND, and an ORDER BY. Anything else is a parse error, as Jira would say. */
  search(jql: string): FakeIssue[] | string {
    const [where = "", order = ""] = jql.split(/\s+order by\s+/i);
    const clauses = where.trim() ? where.split(/\s+AND\s+/i) : [];
    let found = [...this.state.issues];
    for (const clause of clauses) {
      const text = clause.trim();
      let match: RegExpExecArray | null;
      if ((match = /^project\s*=\s*"?(\w+)"?$/i.exec(text))) found = found.filter(({ key }) => key.startsWith(`${match![1]!.toUpperCase()}-`));
      else if ((match = /^key\s*=\s*([A-Z]+-\d+)$/i.exec(text))) found = found.filter(({ key }) => key === match![1]!.toUpperCase());
      else if ((match = /^parent\s*=\s*([A-Z]+-\d+)$/i.exec(text))) found = found.filter(({ parent }) => parent === match![1]!.toUpperCase());
      else if (/^assignee\s*=\s*currentUser\(\)$/i.test(text)) found = found.filter(({ assignee }) => assignee?.accountId === ME.accountId);
      else if (/^reporter\s*=\s*currentUser\(\)$/i.test(text)) found = found.filter(({ reporter }) => reporter.accountId === ME.accountId);
      else if (/^watcher\s*=\s*currentUser\(\)$/i.test(text)) found = found.filter(({ watchers }) => watchers.includes(ME.accountId));
      else if (/^statusCategory\s*!=\s*Done$/i.test(text)) found = found.filter(({ status }) => status.category !== "done");
      else if (/^sprint in openSprints\(\)$/i.test(text)) found = found.filter(({ sprint }) => sprint === SPRINT_7.id || sprint === SPRINT_8.id);
      else if ((match = /^sprint\s*=\s*(\d+)$/i.exec(text))) found = found.filter(({ sprint }) => sprint === Number(match![1]));
      else if ((match = /^text\s*~\s*"(.*)"$/i.exec(text))) {
        const words = match[1]!.toLowerCase();
        found = found.filter((issue) => JSON.stringify([issue.summary, issue.description, issue.comments.map(({ body }) => body)]).toLowerCase().includes(words));
      } else return `failed to parse JQL query: error in the jql query: expecting operator but got '${text.split(/\s+/)[0]}'.`;
    }
    if (/updated/i.test(order)) found.sort((a, b) => b.updated.localeCompare(a.updated));
    if (/created/i.test(order)) found.sort((a, b) => b.created.localeCompare(a.created));
    return found;
  }

  private touch(issue: FakeIssue) {
    issue.updated = new Date().toISOString().replace("Z", "+0000");
  }

  answer(program: string, args: string[]): Ran {
    if (program !== "acli") return fail(`the fake knows only acli, not ${program}`);
    this.log.push(args);
    const flag = (name: string) => {
      const index = args.indexOf(name);
      return index >= 0 ? args[index + 1] : undefined;
    };
    const command = args.slice(0, 3).join(" ");
    if (args[0] === "jira" && args[1] === "auth" && args[2] === "status")
      return this.state.signedIn ? ok(`✓ Authenticated\n  Site: ${SITE}\n  Email: ${ME.emailAddress}\n  Authentication Type: oauth\n`) : fail("unauthorized: use 'acli jira auth login' to authenticate");
    if (!this.state.signedIn) return fail("unauthorized: use 'acli jira auth login' to authenticate");
    switch (command) {
      case "jira project view":
        return flag("--key") === PROJECT ? ok(JSON.stringify({ key: PROJECT, name: "Kite", issueTypes: ISSUE_TYPES })) : fail("No project could be found with key.");
      case "jira board list-sprints":
        return flag("--id") === String(SPRINT_7.boardId) ? ok(JSON.stringify({ sprints: [SPRINT_7, SPRINT_8], isLast: true })) : fail("Board does not exist.");
      case "jira workitem search": {
        const found = this.search(flag("--jql") ?? "");
        if (typeof found === "string") return fail(found);
        if (args.includes("--count")) return ok(`✓ Number of work items in the search: ${found.length}\n`);
        const fields = (flag("--fields") ?? "issuetype,key,assignee,priority,status,summary").split(",");
        const refused = fields.filter((field) => !SEARCH_FIELDS.has(field));
        if (refused.length) return fail(`fields '${refused.join(", ")}' are not allowed`);
        return ok(JSON.stringify(found.slice(0, Number(flag("--limit") ?? 50)).map((issue) => this.searchJson(issue, fields))));
      }
      case "jira workitem view": {
        const issue = this.issue(args[3] ?? "");
        return issue ? ok(JSON.stringify(this.viewJson(issue))) : fail("Issue does not exist or you do not have permission to see it.");
      }
      case "jira workitem transition": {
        const issue = this.issue(flag("--key") ?? "");
        const to = flag("--status") ?? "";
        if (!issue) return fail("Issue does not exist or you do not have permission to see it.");
        if (!WORKFLOW[issue.status.name]?.includes(to)) return fail(`no transition to status '${to}' exists for ${issue.key}`);
        issue.status = Object.values(STATUSES).find(({ name }) => name === to)!;
        this.touch(issue);
        return ok(`✓ Work item ${issue.key} transitioned to ${to}\n`);
      }
      case "jira workitem assign": {
        const issue = this.issue(flag("--key") ?? "");
        if (!issue) return fail("Issue does not exist or you do not have permission to see it.");
        const to = flag("--assignee");
        issue.assignee = args.includes("--remove-assignee") ? null : (PEOPLE.find(({ accountId }) => accountId === (to === "@me" ? ME.accountId : to)) ?? null);
        this.touch(issue);
        return ok(`✓ Work item ${issue.key} assigned\n`);
      }
      case "jira workitem edit": {
        const fromJson = flag("--from-json");
        if (fromJson) {
          const edit = JSON.parse(readFileSync(fromJson, "utf8")) as { issues: string[]; labelsToAdd?: string[]; labelsToRemove?: string[]; description?: unknown; summary?: string };
          for (const key of edit.issues) {
            const issue = this.issue(key);
            if (!issue) return fail("Issue does not exist or you do not have permission to see it.");
            issue.labels = [...issue.labels.filter((label) => !(edit.labelsToRemove ?? []).includes(label)), ...(edit.labelsToAdd ?? []).filter((label) => !issue.labels.includes(label))];
            if (edit.description) issue.description = edit.description;
            if (edit.summary) issue.summary = edit.summary;
            this.touch(issue);
          }
          return ok(`✓ Work item ${edit.issues.join(", ")} edited\n`);
        }
        const issue = this.issue(flag("--key") ?? "");
        if (!issue) return fail("Issue does not exist or you do not have permission to see it.");
        if (flag("--summary")) issue.summary = flag("--summary")!;
        this.touch(issue);
        return ok(`✓ Work item ${issue.key} edited\n`);
      }
      case "jira workitem comment": {
        const issue = this.issue(flag("--key") ?? "");
        if (args[3] !== "create" || !issue) return fail("Issue does not exist or you do not have permission to see it.");
        const body = JSON.parse(readFileSync(flag("--body-file")!, "utf8")) as unknown;
        const at = new Date().toISOString().replace("Z", "+0000");
        issue.comments.push({ id: String(this.state.nextComment++), author: ME, body, created: at, updated: at });
        return ok(`✓ Comment added to ${issue.key}\n`);
      }
      case "jira workitem create": {
        if (flag("--project") !== PROJECT) return fail("No project could be found with key.");
        const at = new Date().toISOString().replace("Z", "+0000");
        const descriptionFile = flag("--description-file");
        const issue: FakeIssue = {
          key: `${PROJECT}-${this.state.nextKey++}`,
          summary: flag("--summary") ?? "",
          type: flag("--type") ?? "Task",
          status: STATUSES.todo,
          priority: "Medium",
          assignee: flag("--assignee") === "@me" ? ME : null,
          reporter: ME,
          labels: (flag("--label") ?? "").split(",").filter(Boolean),
          description: descriptionFile ? (JSON.parse(readFileSync(descriptionFile, "utf8")) as unknown) : null,
          parent: flag("--parent") ?? null,
          sprint: null,
          watchers: [ME.accountId],
          links: [],
          comments: [],
          created: at,
          updated: at,
        };
        this.state.issues.push(issue);
        return ok(JSON.stringify({ key: issue.key, id: "20001", self: `https://${SITE}/rest/api/3/issue/20001` }));
      }
      default:
        return fail(`unknown command "${args.join(" ")}"`);
    }
  }
}
