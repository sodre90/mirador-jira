import { markdownToAdf } from "./adf.ts";
import type { AcliProblem, Undo, WriteAction } from "./model.ts";
import { ProgramMissing, type Ran } from "./run.ts";

/** Search can't return more than these; the rest come with an opened issue. */
export const LIST_FIELDS = "issuetype,key,summary,status,priority,assignee,reporter,labels";
export const LIST_LIMIT = 100;

export const authArgs = () => ["jira", "auth", "status"];
export const projectArgs = (key: string) => ["jira", "project", "view", "--key", key, "--json"];
export const listArgs = (jql: string) => ["jira", "workitem", "search", "--jql", jql, "--json", "--limit", String(LIST_LIMIT), "--fields", LIST_FIELDS];
export const countArgs = (jql: string) => ["jira", "workitem", "search", "--jql", jql, "--count"];
export const viewArgs = (key: string) => ["jira", "workitem", "view", key, "--json", "--fields", "*navigable,comment"];
export const sprintsArgs = (board: number) => ["jira", "board", "list-sprints", "--id", String(board), "--state", "active,future", "--json"];

export const countOf = (output: string) => {
  const found = /(\d+)\s*$/.exec(output.trim());
  return found ? Number(found[1]) : null;
};

/** A write's command, and the file it reads its rich text or JSON from, which the host writes first. */
export interface WritePlan {
  args: string[];
  file: { name: string; content: string } | null;
}

/** Stands in the arguments for the file's path until the host knows it. */
export const FILE = "\u0000file";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export function writePlan(action: WriteAction, myAccountId: string | null): WritePlan {
  switch (action.kind) {
    case "transition":
      return { args: ["jira", "workitem", "transition", "--key", action.key, "--status", action.status, "--yes"], file: null };
    case "assign":
      if (!action.to) return { args: ["jira", "workitem", "assign", "--key", action.key, "--remove-assignee", "--yes"], file: null };
      return { args: ["jira", "workitem", "assign", "--key", action.key, "--assignee", action.to.accountId === myAccountId ? "@me" : action.to.accountId, "--yes"], file: null };
    case "labels":
      return { args: ["jira", "workitem", "edit", "--from-json", FILE, "--yes"], file: { name: "labels.json", content: json({ issues: [action.key], labelsToAdd: action.add, labelsToRemove: action.remove }) } };
    case "comment":
      return { args: ["jira", "workitem", "comment", "create", "--key", action.key, "--body-file", FILE], file: { name: "comment.json", content: json(markdownToAdf(action.markdown)) } };
    case "summary":
      return { args: ["jira", "workitem", "edit", "--key", action.key, "--summary", action.summary, "--yes"], file: null };
    case "description":
      return { args: ["jira", "workitem", "edit", "--from-json", FILE, "--yes"], file: { name: "description.json", content: json({ issues: [action.key], description: markdownToAdf(action.markdown) }) } };
    case "create":
      return {
        args: [
          "jira",
          "workitem",
          "create",
          "--project",
          action.project,
          "--type",
          action.type,
          "--summary",
          action.summary,
          ...(action.markdown.trim() ? ["--description-file", FILE] : []),
          ...(action.labels.length ? ["--label", action.labels.join(",")] : []),
          ...(action.parent ? ["--parent", action.parent] : []),
          ...(action.assignToMe ? ["--assignee", "@me"] : []),
          "--json",
        ],
        file: action.markdown.trim() ? { name: "description.json", content: json(markdownToAdf(action.markdown)) } : null,
      };
  }
}

/** The write that puts an Undo's field back. */
export function undoAction(undo: Undo): WriteAction {
  switch (undo.kind) {
    case "status":
      return { kind: "transition", key: undo.key, status: undo.from };
    case "assignee":
      return { kind: "assign", key: undo.key, to: undo.from };
    case "labels":
      return { kind: "labels", key: undo.key, add: undo.removed, remove: undo.added };
  }
}

const quoted = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`);

/** The command as the user could type it, with the file's name where its path goes. */
export function shellText(plan: WritePlan): string {
  return ["acli", ...plan.args.map((arg) => (arg === FILE ? (plan.file?.name ?? "file") : arg))].map(quoted).join(" ");
}

/** acli's words for a failure, without its ✗ and "Error:". */
const wordsOf = (ran: Ran) =>
  (ran.stderr.trim() || ran.stdout.trim() || `acli stopped with code ${ran.code}.`)
    .split("\n")
    .map((line) => line.replace(/^\s*[✗×]\s*/, "").replace(/^Error:\s*/i, ""))
    .filter(Boolean)
    .join(" ");

export function problemOf(failure: Ran | ProgramMissing): AcliProblem {
  if (failure instanceof ProgramMissing) return { code: "not-installed", message: "acli, the Atlassian CLI, isn't installed or isn't on Mirador's PATH." };
  const message = wordsOf(failure);
  if (/unauthori[sz]ed|not (logged|signed) in|log ?in first|auth(entication)? (required|failed|expired)|\b401\b|token.*expired/i.test(message)) return { code: "not-signed-in", message };
  if (/jql/i.test(message)) return { code: "bad-query", message };
  if (/does not exist|not found|could not be found|no project|permission to see|\b404\b/i.test(message)) return { code: "not-found", message };
  return { code: "failed", message };
}

/** The key acli says it created: from its JSON, or the first key in what it printed. */
export function createdKeyOf(output: string): string | null {
  try {
    const created = JSON.parse(output) as { key?: unknown };
    if (typeof created.key === "string") return created.key;
  } catch {}
  return /\b([A-Z][A-Z0-9_]+-\d+)\b/.exec(output)?.[1] ?? null;
}
