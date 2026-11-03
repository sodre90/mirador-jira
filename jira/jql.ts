import type { SavedView, ViewId } from "./model.ts";

export interface BuiltInView {
  id: Exclude<ViewId, `saved:${string}`>;
  name: string;
  hint: string;
}

export const BUILT_IN_VIEWS: BuiltInView[] = [
  { id: "mine", name: "Mine", hint: "Assigned to you and not done" },
  { id: "sprint", name: "Sprint", hint: "The sprint you picked, as a board" },
  { id: "recent", name: "Recent", hint: "Everything in the project, last updated first" },
  { id: "reported", name: "Reported", hint: "Reported by you and not done" },
  { id: "watching", name: "Watching", hint: "Watched by you and not done" },
];

/** A project key as JQL takes it: quoted when it isn't plain letters and digits. */
const project = (key: string) => (/^[A-Z][A-Z0-9_]*$/.test(key) ? key : `"${key.replace(/"/g, '\\"')}"`);

export function viewJql(view: ViewId, projectKey: string, sprint: number | null, saved: SavedView[]): string {
  const inProject = `project = ${project(projectKey)}`;
  switch (view) {
    case "mine":
      return `${inProject} AND assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`;
    case "sprint":
      return `${inProject} AND ${sprint === null ? "sprint in openSprints()" : `sprint = ${sprint}`} ORDER BY Rank ASC`;
    case "recent":
      return `${inProject} ORDER BY updated DESC`;
    case "reported":
      return `${inProject} AND reporter = currentUser() AND statusCategory != Done ORDER BY created DESC`;
    case "watching":
      return `${inProject} AND watcher = currentUser() AND statusCategory != Done ORDER BY updated DESC`;
    default:
      return saved.find(({ name }) => `saved:${name}` === view)?.jql ?? `${inProject} ORDER BY updated DESC`;
  }
}

export const ISSUE_KEY = /\b([A-Z][A-Z0-9_]+-\d+)\b/;

const JQL_SIGNS = /(\s(=|!=|~|!~|>=?|<=?|in|not in|is|is not|was|changed)\s)|\border by\b|\(\)/i;

/** What the search box asks for: JQL as written, an issue by its key, or words searched in the project. */
export function searchJql(typed: string, projectKey: string): string {
  const query = typed.trim();
  if (JQL_SIGNS.test(` ${query} `)) return query;
  const key = new RegExp(`^${ISSUE_KEY.source}$`, "i").exec(query)?.[1];
  if (key) return `key = ${key.toUpperCase()}`;
  return `project = ${project(projectKey)} AND text ~ "${query.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" ORDER BY updated DESC`;
}

/** The issues under an epic or parent, in the board's order. */
export const childrenJql = (key: string) => `parent = ${key} ORDER BY Rank ASC`;
