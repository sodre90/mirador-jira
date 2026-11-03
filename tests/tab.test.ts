import { describe, expect, test } from "bun:test";
import type { WorkspaceTabContext } from "../mirador/api.ts";
import { childrenJql, viewJql } from "../jira/jql.ts";
import type { TabState, WriteReply } from "../jira/model.ts";
import type { Runner } from "../jira/run.ts";
import { JiraTab, MIN_READ_GAP_MS, TIMER_READ_GAP_MS } from "../jira/tab.ts";
import { ProgramMissing } from "../jira/run.ts";
import { FakeJira } from "./fake-acli.ts";

const COMMITS = "KITE-412 Keep notes when a folder is renamed\nKITE-377 Export as Markdown\nUse UTF-8 everywhere";
const BRANCHES = "main\nkite-421-accents";

function setUp({ commits = COMMITS, branches = BRANCHES } = {}) {
  const jira = new FakeJira();
  const runner: Runner = async (program, args, options) => {
    if (program !== "git") return jira.runner(program, args, options);
    return { code: 0, stdout: args[0] === "log" ? commits : branches, stderr: "" };
  };
  const stored = new Map<string, unknown>();
  let clock = 1_000_000;
  const context: WorkspaceTabContext = {
    workspace: { id: "w1", name: "kite", folder: "/tmp/kite" },
    storage: { get: (key) => stored.get(key), set: (key, value) => void (value === undefined ? stored.delete(key) : stored.set(key, value)) },
    sharedStorage: { get: () => undefined, set: () => {} },
    changed: () => {},
  };
  const tab = new JiraTab(runner, () => clock);
  const state = () => tab.state(context) as Promise<TabState>;
  const act = (action: object) => tab.action(action, context);
  const pass = (ms: number) => void (clock += ms);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  return { jira, tab, context, state, act, pass, settle, stored };
}

const KITE_ONLY = { project: "KITE", sources: [] };
const MINE = viewJql("mine", KITE_ONLY, null, []);

async function connected() {
  const setup = setUp();
  await setup.act({ kind: "connect", project: "KITE" });
  await setup.act({ kind: "refresh", jql: MINE, counts: false });
  return setup;
}

describe("connecting", () => {
  test("the tab shows in a folder whose history names issue keys, and offers the project it names most", async () => {
    const { tab, context, state } = setUp();
    expect(await tab.shows(context)).toBe(true);
    expect((await state()).candidates).toEqual([{ project: "KITE", mentions: 3 }]);
    expect(await setUp({ commits: "Bump to v2", branches: "main" }).tab.shows(context)).toBe(false);
  });

  test("connecting checks the project with acli and keeps the site acli is signed in to", async () => {
    const { act, state } = setUp();
    await act({ kind: "connect", project: "kite" });
    expect((await state()).connection).toEqual({ site: "https://kite.example.com", project: "KITE", projectName: "Kite", sources: [] });
    expect((await state()).issueTypes.KITE!.map(({ name }) => name)).toContain("Bug");
  });

  test("before connecting, a signed-out or missing acli becomes the tab's problem, so the panel shows its fix", async () => {
    const signedOut = setUp();
    signedOut.jira.state.signedIn = false;
    await signedOut.act({ kind: "connect", project: "KITE" }).catch(() => {});
    expect((await signedOut.state()).problem?.code).toBe("not-signed-in");
    const stored = new Map<string, unknown>();
    const missing: WorkspaceTabContext = {
      workspace: { id: "w2", name: "kite", folder: "/tmp/kite" },
      storage: { get: (key) => stored.get(key), set: (key, value) => void stored.set(key, value) },
      sharedStorage: { get: () => undefined, set: () => {} },
      changed: () => {},
    };
    const tab = new JiraTab(async (program) => {
      throw new ProgramMissing(program);
    });
    await tab.action({ kind: "connect", project: "KITE" }, missing).catch(() => {});
    expect(((await tab.state(missing)) as TabState).problem?.code).toBe("not-installed");
  });

  test("a project Jira doesn't have, or acli signed out, says so", async () => {
    const { act, jira } = setUp();
    await expect(act({ kind: "connect", project: "NOPE" })).rejects.toThrow("Jira has no project NOPE on kite.example.com");
    jira.state.signedIn = false;
    await expect(act({ kind: "connect", project: "KITE" })).rejects.toThrow("unauthorized");
  });
});

describe("reading", () => {
  test("a view's list comes from search, who I am from the issues assigned to me, and the statuses from Recent, read once", async () => {
    const { state } = await connected();
    const { lists, me, statuses } = await state();
    expect(lists[MINE]?.issues.map(({ key }) => key)).toEqual(["KITE-412", "KITE-421"]);
    expect(me).toEqual({ email: "dana@kite.example.com", accountId: "acct-dana" });
    expect(statuses.KITE!.map(({ name }) => name).sort()).toEqual(["Done", "In Progress", "In Review", "To Do"]);
  });

  test("however many views ask, a list is read at most once per gap", async () => {
    const { act, jira, pass } = await connected();
    const minesReads = () => jira.log.filter((args) => args[2] === "search" && args.includes(MINE)).length;
    await Promise.all([act({ kind: "refresh", jql: MINE, counts: false }), act({ kind: "refresh", jql: MINE, counts: false })]);
    expect(minesReads()).toBe(1);
    pass(MIN_READ_GAP_MS);
    await act({ kind: "refresh", jql: MINE, counts: false });
    expect(minesReads()).toBe(2);
    expect(jira.log.filter((args) => args[2] === "search" && !args.includes(MINE))).toHaveLength(1);
  });

  test("a timer's read waits out a longer gap, as every hidden frame runs one", async () => {
    const { act, jira, pass } = await connected();
    const minesReads = () => jira.log.filter((args) => args[2] === "search" && args.includes(MINE)).length;
    pass(MIN_READ_GAP_MS * 2);
    await act({ kind: "refresh", jql: MINE, counts: false, by: "timer" });
    await act({ kind: "refresh", jql: MINE, counts: false, by: "timer" });
    expect(minesReads()).toBe(1);
    pass(TIMER_READ_GAP_MS);
    await act({ kind: "refresh", jql: MINE, counts: false, by: "timer" });
    expect(minesReads()).toBe(2);
    await act({ kind: "refresh", jql: MINE, counts: false, force: true });
    expect(minesReads()).toBe(3);
  });

  test("once acli signs in again, the problem goes with the next read", async () => {
    const { act, jira, pass, state } = await connected();
    jira.state.signedIn = false;
    pass(MIN_READ_GAP_MS);
    await act({ kind: "refresh", jql: MINE, counts: false });
    expect((await state()).problem?.code).toBe("not-signed-in");
    jira.state.signedIn = true;
    await act({ kind: "refresh", jql: MINE, counts: false, force: true });
    const { problem, lists } = await state();
    expect(problem).toBeNull();
    expect(lists[MINE]?.problem).toBeNull();
    expect(lists[MINE]?.issues).toHaveLength(2);
  });

  test("an opened issue has its description, comments, links, parent and sprint; the sprint joins the picker", async () => {
    const { act, state } = await connected();
    await act({ kind: "open", key: "KITE-412" });
    const { details, sprints } = await state();
    expect(details["KITE-412"]?.detail).toMatchObject({ parent: { key: "KITE-9" }, links: [{ key: "KITE-398", relation: "is blocked by" }] });
    expect(details["KITE-412"]?.detail?.comments).toHaveLength(2);
    expect(sprints.map(({ name }) => name)).toEqual(["Kite sprint 7"]);
  });

  test("the Sprint view picks the active sprint of my issues, and its board's next sprint joins it", async () => {
    const { act, state } = await connected();
    await act({ kind: "find-sprints" });
    const { sprints, prefs } = await state();
    expect(sprints.map(({ name, state: sprintState }) => `${name} ${sprintState}`)).toEqual(["Kite sprint 7 active", "Kite sprint 8 future"]);
    expect(prefs.sprint).toBe(7007);
  });

  test("an epic's children come from a parent query", async () => {
    const { act, state } = await connected();
    await act({ kind: "refresh", jql: childrenJql("KITE-9"), counts: false });
    const { lists } = await state();
    expect(lists[childrenJql("KITE-9")]?.issues.map(({ key }) => key).sort()).toEqual(["KITE-360", "KITE-398", "KITE-412"].sort());
  });

  test("bad JQL shows on its list in Jira's words, and the tab keeps working", async () => {
    const { act, state } = await connected();
    await act({ kind: "refresh", jql: "project KITE", counts: false });
    const { lists, problem } = await state();
    expect(lists["project KITE"]?.problem?.code).toBe("bad-query");
    expect(problem).toBeNull();
  });

  test("the views' counts come with the first refresh that asks, not with every poll", async () => {
    const { act, state, jira } = await connected();
    await act({ kind: "refresh", jql: MINE, counts: true });
    expect((await state()).counts[MINE]).toBe(2);
    const counted = jira.calls("jira", "workitem", "search") ;
    await act({ kind: "refresh", jql: MINE, counts: true });
    expect(jira.calls("jira", "workitem", "search")).toBe(counted);
  });
});

describe("changes made at once", () => {
  test("a transition shows at once, and Undo moves it back", async () => {
    const { act, state, jira } = await connected();
    const reply = (await act({ kind: "transition", key: "KITE-412", status: "In Review" })) as WriteReply;
    expect((await state()).lists[MINE]?.issues.find(({ key }) => key === "KITE-412")?.status.name).toBe("In Review");
    expect(reply.undo).toEqual({ kind: "status", key: "KITE-412", from: "In Progress", to: "In Review" });
    await act({ kind: "undo", undo: reply.undo });
    expect(jira.state.issues.find(({ key }) => key === "KITE-412")?.status.name).toBe("In Progress");
  });

  test("Undo leaves a status that someone changed since", async () => {
    const { act, jira } = await connected();
    const reply = (await act({ kind: "transition", key: "KITE-412", status: "In Review" })) as WriteReply;
    jira.answer("acli", ["jira", "workitem", "transition", "--key", "KITE-412", "--status", "Done", "--yes"]);
    await expect(act({ kind: "undo", undo: reply.undo })).rejects.toThrow("KITE-412 (Notes vanish after renaming a folder) changed since");
    expect(jira.state.issues.find(({ key }) => key === "KITE-412")?.status.name).toBe("Done");
  });

  test("a transition the workflow doesn't allow reaches the user in Jira's words", async () => {
    const { act } = await connected();
    await act({ kind: "transition", key: "KITE-412", status: "Done" });
    await expect(act({ kind: "transition", key: "KITE-412", status: "In Review" })).rejects.toThrow("no transition to status 'In Review'");
  });

  test("assigning myself, with Undo back to nobody", async () => {
    const { act, jira, state } = await connected();
    await act({ kind: "refresh", jql: viewJql("recent", KITE_ONLY, null, []), counts: false });
    const me = (await state()).people.find(({ name }) => name === "Dana Reyes")!;
    const reply = (await act({ kind: "assign", key: "KITE-398", to: me })) as WriteReply;
    expect(jira.log.find((args) => args[2] === "assign")).toEqual(["jira", "workitem", "assign", "--key", "KITE-398", "--assignee", "@me", "--yes"]);
    await act({ kind: "undo", undo: reply.undo });
    expect(jira.state.issues.find(({ key }) => key === "KITE-398")?.assignee).toBeNull();
  });

  test("labels come back as they were", async () => {
    const { act, jira } = await connected();
    const reply = (await act({ kind: "labels", key: "KITE-412", add: ["regression"], remove: ["sync"] })) as WriteReply;
    expect(jira.state.issues.find(({ key }) => key === "KITE-412")?.labels).toEqual(["regression"]);
    await act({ kind: "undo", undo: reply.undo });
    expect(jira.state.issues.find(({ key }) => key === "KITE-412")?.labels).toEqual(["sync"]);
  });
});

describe("changes the user confirms", () => {
  test("a comment goes to Jira as rich text and shows once read again", async () => {
    const { act, state, jira, settle } = await connected();
    await act({ kind: "open", key: "KITE-412" });
    await act({ kind: "comment", key: "KITE-412", markdown: "Fixed in **1.8.3**." });
    await settle();
    const added = jira.state.issues.find(({ key }) => key === "KITE-412")!.comments.at(-1)!;
    expect(added.body).toMatchObject({ type: "doc", content: [{ type: "paragraph" }] });
    expect((await state()).details["KITE-412"]?.detail?.comments).toHaveLength(3);
  });

  test("a created issue's key comes back", async () => {
    const { act, jira } = await connected();
    const reply = (await act({ kind: "create", project: "KITE", type: "Bug", summary: "Crash on empty note", markdown: "Open an empty note.", labels: ["crash"], parent: null, assignToMe: true })) as WriteReply;
    expect(reply.key).toBe("KITE-431");
    expect(jira.state.issues.at(-1)).toMatchObject({ summary: "Crash on empty note", assignee: { accountId: "acct-dana" }, labels: ["crash"] });
  });
});

describe("sources", () => {
  const addEscalations = (act: (action: object) => Promise<unknown>) => act({ kind: "add-source", name: "Escalations", project: "sup", filter: 'component = "Kite"' });

  test("a connection stored before sources still loads, with none", async () => {
    const { context, state } = setUp();
    context.storage.set("connection", { site: "https://kite.example.com", project: "KITE", projectName: "Kite" });
    expect((await state()).connection?.sources).toEqual([]);
  });

  test("looking a project up gives its name and components", async () => {
    const { act } = await connected();
    expect(await act({ kind: "look-up-project", project: "sup" })).toEqual({ project: "SUP", name: "Kite support", components: ["Billing", "Kite", "Sync"] });
    await expect(act({ kind: "look-up-project", project: "NOPE" })).rejects.toThrow("Jira has no project NOPE");
  });

  test("an added source joins Mine, only as far as its filter lets in, and has a view of its own", async () => {
    const { act, state, pass, settle } = await connected();
    expect(await addEscalations(act)).toEqual({ added: "Escalations", found: 2 });
    const { connection } = await state();
    await settle();
    expect((await state()).counts[viewJql("source:Escalations", connection!, null, [])]).toBe(2);
    const mine = viewJql("mine", connection!, null, []);
    pass(MIN_READ_GAP_MS);
    await act({ kind: "refresh", jql: mine, counts: true });
    await act({ kind: "refresh", jql: viewJql("source:Escalations", connection!, null, []), counts: false });
    const { lists, counts, statuses, issueTypes } = await state();
    expect(lists[mine]?.issues.map(({ key }) => key).sort()).toEqual(["KITE-412", "KITE-421", "SUP-21"]);
    expect(lists[viewJql("source:Escalations", connection!, null, [])]?.issues.map(({ key }) => key).sort()).toEqual(["SUP-21", "SUP-23"]);
    expect(counts[viewJql("source:Escalations", connection!, null, [])]).toBe(2);
    expect(statuses.SUP!.map(({ name }) => name)).toContain("Waiting for support");
    expect(statuses.KITE!.map(({ name }) => name)).not.toContain("Waiting for support");
    expect(issueTypes.SUP!.map(({ name }) => name)).toEqual(["Escalation", "Question"]);
  });

  test("a component Jira doesn't have, a sorting filter or a taken name is refused before it's added", async () => {
    const { act, state } = await connected();
    await expect(act({ kind: "add-source", name: "Escalations", project: "SUP", filter: 'component = "Kiet"' })).rejects.toThrow("Jira can't read that filter: failed to parse JQL query: the value 'kiet' does not exist for the field 'component'.");
    await expect(act({ kind: "add-source", name: "Escalations", project: "SUP", filter: "labels = x ORDER BY created" })).rejects.toThrow("can't sort");
    await expect(act({ kind: "add-source", name: "Mine", project: "SUP", filter: "" })).rejects.toThrow('There\'s a view called "Mine" already');
    expect((await state()).connection?.sources).toEqual([]);
  });

  test("a new issue can go in a source's project but no other, and a source can be removed", async () => {
    const { act, state } = await connected();
    await addEscalations(act);
    await expect(act({ kind: "save-view", name: "escalations", jql: "labels = x" })).rejects.toThrow("a source's view");
    const created = (await act({ kind: "create", project: "SUP", type: "Escalation", summary: "Export fails for a team", markdown: "", labels: [], parent: null, assignToMe: false })) as WriteReply;
    expect(created.key).toMatch(/^SUP-/);
    await expect(act({ kind: "create", project: "OPS", type: "Task", summary: "x", markdown: "", labels: [], parent: null, assignToMe: false })).rejects.toThrow("not OPS");
    await act({ kind: "remove-source", name: "Escalations" });
    expect((await state()).connection?.sources).toEqual([]);
  });
});

