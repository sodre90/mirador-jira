import type { Connection, SavedView, Sort, Source, ViewId } from "./model.ts";

export interface BuiltInView {
  id: Exclude<ViewId, `saved:${string}` | `source:${string}`>;
  name: string;
  hint: string;
}

export const BUILT_IN_VIEWS: BuiltInView[] = [
  { id: "mine", name: "Mine", hint: "Assigned to you and not done" },
  { id: "sprint", name: "Sprint", hint: "The sprint you picked, as a board" },
  { id: "recent", name: "Recent", hint: "Everything in the workspace's projects, last updated first" },
  { id: "reported", name: "Reported", hint: "Reported by you and not done" },
  { id: "watching", name: "Watching", hint: "Watched by you and not done" },
];

/** A project key as JQL takes it: quoted when it isn't plain letters and digits. */
const project = (key: string) => (/^[A-Z][A-Z0-9_]*$/.test(key) ? key : `"${key.replace(/"/g, '\\"')}"`);

/** The projects a workspace's views search: its own, and each source as far as its filter lets in. */
export type Scope = Pick<Connection, "project" | "sources">;

export const sourceJql = ({ project: key, filter }: Pick<Source, "project" | "filter">) => (filter.trim() ? `project = ${project(key)} AND (${filter.trim()})` : `project = ${project(key)}`);

/** Every source in its own parentheses, and the whole in one more, so AND after it can't reach into a filter. */
export function scopeJql({ project: key, sources }: Scope): string {
  if (sources.length === 0) return `project = ${project(key)}`;
  return `(${[`project = ${project(key)}`, ...sources.map(sourceJql)].map((part) => `(${part})`).join(" OR ")})`;
}

/** A source's filter for one component. */
export const componentFilter = (component: string) => `component = "${component.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** A filter joins other JQL, so it can't sort, and its parentheses must close. */
export function filterProblem(filter: string): string | null {
  if (/\border\s+by\b/i.test(filter)) return "A source's filter can't sort: leave out ORDER BY.";
  const depth = [...filter.replace(/"(\\.|[^"])*"/g, "")].reduce((open, char) => (open < 0 ? open : open + (char === "(" ? 1 : char === ")" ? -1 : 0)), 0);
  return depth === 0 ? null : "The filter's parentheses don't match.";
}

/** The view as the tab can show it: a removed source or saved view is Mine again. */
export function viewShown(view: ViewId, { sources }: Scope, saved: SavedView[]): ViewId {
  if (view.startsWith("source:")) return sources.some(({ name }) => `source:${name}` === view) ? view : "mine";
  if (view.startsWith("saved:")) return saved.some(({ name }) => `saved:${name}` === view) ? view : "mine";
  return view;
}

export const SORTS: { id: Sort; name: string }[] = [
  { id: "updated", name: "Last updated" },
  { id: "priority", name: "Priority" },
  { id: "created", name: "Newest" },
];

const ORDER_BY: Record<Sort, string> = { updated: "updated DESC", priority: "priority DESC, updated DESC", created: "created DESC" };

/** The order a view lists in until the user picks another; null for views whose order is their point, or their JQL's. */
export function ownSort(view: ViewId): Sort | null {
  if (view === "mine" || view === "watching" || view.startsWith("source:")) return "updated";
  if (view === "reported") return "created";
  return null;
}

/** A view's JQL, in the order picked for it. Counts are read and keyed in each view's own order, which doesn't change them. */
export function viewJql(view: ViewId, scope: Scope, sprint: number | null, saved: SavedView[], sort: Sort | null = null): string {
  const inScope = scopeJql(scope);
  const shown = viewShown(view, scope, saved);
  const orderBy = `ORDER BY ${ORDER_BY[sort ?? ownSort(shown) ?? "updated"]}`;
  switch (shown) {
    case "mine":
      return `${inScope} AND assignee = currentUser() AND statusCategory != Done ${orderBy}`;
    case "sprint":
      return `project = ${project(scope.project)} AND ${sprint === null ? "sprint in openSprints()" : `sprint = ${sprint}`} ORDER BY Rank ASC`;
    case "recent":
      return `${inScope} ORDER BY updated DESC`;
    case "reported":
      return `${inScope} AND reporter = currentUser() AND statusCategory != Done ${orderBy}`;
    case "watching":
      return `${inScope} AND watcher = currentUser() AND statusCategory != Done ${orderBy}`;
    default: {
      const source = scope.sources.find(({ name }) => `source:${name}` === shown);
      if (source) return `${sourceJql(source)} ${orderBy}`;
      return saved.find(({ name }) => `saved:${name}` === shown)!.jql;
    }
  }
}

/** Every view's JQL, built-in, sources' and saved, as the counts and the top bar key them. */
export function allViews(scope: Scope, saved: SavedView[]): { id: ViewId; name: string; hint: string }[] {
  return [
    ...BUILT_IN_VIEWS,
    ...scope.sources.map(({ name, project: key, filter }) => ({ id: `source:${name}` as const, name, hint: filter.trim() ? `${key} where ${filter.trim()}` : `All of ${key}` })),
    ...saved.map(({ name, jql }) => ({ id: `saved:${name}` as const, name, hint: jql })),
  ];
}

/** The project an issue key belongs to. */
export const projectOf = (key: string) => key.replace(/-\d+$/, "");

export const ISSUE_KEY = /\b([A-Z][A-Z0-9_]+-\d+)\b/;

const JQL_SIGNS = /(\s(=|!=|~|!~|>=?|<=?|in|not in|is|is not|was|changed)\s)|\border by\b|\(\)/i;

/** What the search box asks for: JQL as written, an issue by its key, or words searched in the project. */
export function searchJql(typed: string, scope: Scope): string {
  const query = typed.trim();
  if (JQL_SIGNS.test(` ${query} `)) return query;
  const key = new RegExp(`^${ISSUE_KEY.source}$`, "i").exec(query)?.[1];
  if (key) return `key = ${key.toUpperCase()}`;
  return `${scopeJql(scope)} AND text ~ "${query.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" ORDER BY updated DESC`;
}

/** The issues under an epic or parent, in the board's order. */
export const childrenJql = (key: string) => `parent = ${key} ORDER BY Rank ASC`;
