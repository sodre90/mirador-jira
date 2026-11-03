import { describe, expect, test } from "bun:test";
import { FILE, problemOf, shellText, writePlan } from "../jira/acli.ts";
import { adfToMarkdown, adfToText, editableAsMarkdown, markdownToAdf, type AdfNode } from "../jira/adf.ts";
import { candidatesOf } from "../jira/detect.ts";
import { searchJql, viewJql } from "../jira/jql.ts";
import { detailOf, issueOf } from "../jira/normalize.ts";
import { FakeJira } from "./fake-acli.ts";

const viewed = (key: string) => detailOf(JSON.parse(new FakeJira().answer("acli", ["jira", "workitem", "view", key, "--json"]).stdout));

describe("rich text", () => {
  test("Markdown becomes Jira's rich text, and comes back the same", () => {
    const markdown = "## Steps\n\nRename a **folder** while *offline*, see `notes.db`, read [the guide](https://example.com/guide).\n\n1. Turn on airplane mode\n2. Rename it\n\n- one\n- two\n\n```ts\nreplay(queue);\n```\n\n> Seen on Android too.";
    const adf = markdownToAdf(markdown);
    expect(adf).toMatchObject({ version: 1, type: "doc" });
    expect(adf.content?.[0]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Steps" }] });
    expect(adf.content?.[1]?.content).toContainEqual({ type: "text", text: "folder", marks: [{ type: "strong" }] });
    expect(adf.content?.[1]?.content).toContainEqual({ type: "text", text: "the guide", marks: [{ type: "link", attrs: { href: "https://example.com/guide" } }] });
    expect(adfToMarkdown(adf)).toBe(markdown);
    expect(editableAsMarkdown(adf)).toBe(true);
  });

  test("a document with mentions, tables or media stays out of Markdown, so editing never loses them", () => {
    const mention: AdfNode = { version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: "acct-lee", text: "@Lee Park" } }] }] };
    expect(editableAsMarkdown(mention)).toBe(false);
    expect(editableAsMarkdown(markdownToAdf("| a | b |\n|---|---|\n| 1 | 2 |"))).toBe(false);
    expect(editableAsMarkdown({ version: 1, type: "doc", content: [{ type: "mediaSingle", content: [{ type: "media", attrs: { id: "x" } }] }] })).toBe(false);
  });

  test("Jira's own local ids don't keep a plain document from being edited", () => {
    expect(editableAsMarkdown({ version: 1, type: "doc", content: [{ type: "paragraph", attrs: { localId: "a1b2" }, content: [{ type: "text", text: "Plain " }, { type: "text", text: "bold", marks: [{ type: "strong" }] }] }] })).toBe(true);
  });

  test("plain text keeps lists, mentions and table cells readable", () => {
    expect(adfToText(viewed("KITE-412")?.description)).toBe("Rename a folder while offline, then reconnect: its notes are gone from the list.\n1. Turn on airplane mode\n2. Rename a folder\n3. Turn it off\nSeen on 1.8.2.");
    expect(adfToText(viewed("KITE-421")?.description)).toBe("Searching cafe doesn't find café. @Lee Park knows the index.");
    expect(adfToText(markdownToAdf("| a | b |\n|---|---|\n| 1 | 2 |"))).toBe("a | b\n1 | 2");
  });
});

describe("JQL", () => {
  test("each view asks for its issues in the project", () => {
    expect(viewJql("mine", "KITE", null, [])).toBe("project = KITE AND assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC");
    expect(viewJql("sprint", "KITE", 7007, [])).toBe("project = KITE AND sprint = 7007 ORDER BY Rank ASC");
    expect(viewJql("sprint", "KITE", null, [])).toBe("project = KITE AND sprint in openSprints() ORDER BY Rank ASC");
    expect(viewJql("saved:Sync bugs", "KITE", null, [{ name: "Sync bugs", jql: "project = KITE AND labels = sync" }])).toBe("project = KITE AND labels = sync");
  });

  test("the search box takes JQL as written, an issue by its key, or words", () => {
    expect(searchJql("project = KITE AND labels = sync", "KITE")).toBe("project = KITE AND labels = sync");
    expect(searchJql("kite-412", "KITE")).toBe("key = KITE-412");
    expect(searchJql('rename "folder"', "KITE")).toBe('project = KITE AND text ~ "rename \\"folder\\"" ORDER BY updated DESC');
  });
});

describe("finding the project", () => {
  test("the most named project in commits and branches comes first; encodings and lower-case words don't count", () => {
    expect(candidatesOf("KITE-12 Fix sync\nUse UTF-8 everywhere\nKITE-14 Export\nDOCS-3 Typo", "main\nkite-15-banner\nrelease-2\norigin/KITE-16")).toEqual([
      { project: "KITE", mentions: 4 },
      { project: "DOCS", mentions: 1 },
    ]);
    expect(candidatesOf("Bump to v2\nrelease-3", "fix-2")).toEqual([]);
  });
});

describe("acli's answers", () => {
  test("a search row and a full view read as issues, with links both ways, comments and the sprint", () => {
    const row = issueOf({ key: "KITE-412", fields: { summary: "Notes vanish", status: { name: "In Progress", statusCategory: { key: "indeterminate" } }, issuetype: { name: "Bug" }, labels: ["sync"] } });
    expect(row).toMatchObject({ key: "KITE-412", status: { name: "In Progress", category: "indeterminate" }, type: "Bug", labels: ["sync"], assignee: null });
    const detail = viewed("KITE-412")!;
    expect(detail.parent).toMatchObject({ key: "KITE-9", summary: "Offline mode" });
    expect(detail.links).toEqual([{ key: "KITE-398", summary: "Queue edits made offline and replay them", status: { name: "To Do", category: "new" }, type: "Task", relation: "is blocked by" }]);
    expect(viewed("KITE-398")!.links[0]).toMatchObject({ key: "KITE-412", relation: "blocks" });
    expect(detail.comments.map(({ author }) => author?.name)).toEqual(["Lee Park", "Dana Reyes"]);
    expect(detail.sprints).toEqual([{ id: 7007, name: "Kite sprint 7", state: "active", boardId: 77, endDate: "2026-11-07T17:00:00.000Z" }]);
  });

  test("acli's failures read in its own words, and say what kind they are", () => {
    expect(problemOf({ code: 1, stdout: "", stderr: "✗ Error: Issue does not exist or you do not have permission to see it.\n" })).toEqual({ code: "not-found", message: "Issue does not exist or you do not have permission to see it." });
    expect(problemOf({ code: 1, stdout: "", stderr: "✗ Error: failed to parse JQL query: expecting operator" }).code).toBe("bad-query");
    expect(problemOf({ code: 1, stdout: "", stderr: "✗ Error: unauthorized: use 'acli jira auth login' to authenticate" }).code).toBe("not-signed-in");
  });

  test("a write shows as the command it runs, with its rich text in a file", () => {
    expect(shellText(writePlan({ kind: "transition", key: "KITE-412", status: "In Review" }, null))).toBe("acli jira workitem transition --key KITE-412 --status 'In Review' --yes");
    expect(shellText(writePlan({ kind: "assign", key: "KITE-398", to: { accountId: "acct-dana", name: "Dana", email: null } }, "acct-dana"))).toBe("acli jira workitem assign --key KITE-398 --assignee @me --yes");
    const comment = writePlan({ kind: "comment", key: "KITE-412", markdown: "Fixed in **1.8.3**." }, null);
    expect(comment.args).toContain(FILE);
    expect(shellText(comment)).toBe("acli jira workitem comment create --key KITE-412 --body-file comment.json");
    expect(JSON.parse(comment.file!.content).content[0].content[1]).toEqual({ type: "text", text: "1.8.3", marks: [{ type: "strong" }] });
  });
});
