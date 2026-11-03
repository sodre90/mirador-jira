import type { AdfNode } from "./adf.ts";

/** Jira's three status categories, which every workflow's statuses fall in. */
export type StatusCategory = "new" | "indeterminate" | "done";

export interface Status {
  name: string;
  category: StatusCategory;
}

export interface Person {
  accountId: string;
  name: string;
  /** Jira hides it for people who chose so. */
  email: string | null;
}

/** A row of a list: what search returns. */
export interface Issue {
  key: string;
  summary: string;
  type: string;
  subtask: boolean;
  status: Status;
  priority: string | null;
  assignee: Person | null;
  reporter: Person | null;
  labels: string[];
}

export interface IssueType {
  name: string;
  subtask: boolean;
}

export interface Sprint {
  id: number;
  name: string;
  state: "active" | "future" | "closed";
  boardId: number | null;
  endDate: string | null;
}

export interface Comment {
  id: string;
  author: Person | null;
  body: AdfNode | null;
  created: string;
  updated: string;
}

export interface Related {
  key: string;
  summary: string;
  status: Status | null;
  type: string | null;
}

export interface Link extends Related {
  /** In Jira's words for this side: "blocks", "is blocked by", "relates to"… */
  relation: string;
}

/** What `view` adds once an issue is opened. */
export interface Detail extends Issue {
  description: AdfNode | null;
  created: string;
  updated: string;
  resolution: string | null;
  dueDate: string | null;
  components: string[];
  fixVersions: string[];
  parent: Related | null;
  subtasks: Related[];
  links: Link[];
  comments: Comment[];
  sprints: Sprint[];
}

export type AcliProblemCode = "not-installed" | "not-signed-in" | "not-found" | "bad-query" | "failed";

export interface AcliProblem {
  code: AcliProblemCode;
  /** acli's own words, for the user to read. */
  message: string;
}

export interface ListResult {
  issues: Issue[];
  fetchedAt: number | null;
  problem: AcliProblem | null;
}

export interface DetailResult {
  detail: Detail | null;
  fetchedAt: number | null;
  problem: AcliProblem | null;
}

export interface Connection {
  /** The Jira site acli is signed in to, as https://<site>. */
  site: string;
  project: string;
  projectName: string;
  /** Other projects whose issues the workspace takes in too, each perhaps only in part. */
  sources: Source[];
}

/** Another project's issues in the workspace's views, such as the escalations of one component. */
export interface Source {
  /** The name of its own view. */
  name: string;
  project: string;
  projectName: string;
  /** JQL that narrows the project, such as component = "Sync"; empty for the whole project. */
  filter: string;
}

/** What adding a source needs to know of its project. */
export interface ProjectLookup {
  project: string;
  name: string;
  components: string[];
}

/** A project the workspace's git history names, offered to connect to. */
export interface Candidate {
  project: string;
  /** How many branch names and commit messages name one of its keys. */
  mentions: number;
}

export interface Me {
  email: string | null;
  accountId: string | null;
}

export interface SavedView {
  name: string;
  jql: string;
}

export type ViewId = "mine" | "sprint" | "recent" | "reported" | "watching" | `source:${string}` | `saved:${string}`;

/** What the view remembers between visits, for this workspace. */
export interface Prefs {
  view: ViewId;
  /** What the user typed in the search box of each view, when it isn't the view's own query. */
  search: string;
  /** The sprint the Sprint view shows; null for every open sprint. */
  sprint: number | null;
  layout: "board" | "list";
}

export const DEFAULT_PREFS: Prefs = { view: "mine", search: "", sprint: null, layout: "board" };

/** Everything the tab shows for one workspace. */
export interface TabState {
  connection: Connection | null;
  candidates: Candidate[];
  problem: AcliProblem | null;
  me: Me | null;
  /** By JQL. */
  lists: Record<string, ListResult>;
  /** How many issues each view finds, by JQL. */
  counts: Record<string, number>;
  /** By key. */
  details: Record<string, DetailResult>;
  /** The statuses seen in each project, by its key, for the status picker, as Jira can't be asked which transitions an issue has. */
  statuses: Record<string, Status[]>;
  /** The people seen in this project, for the assignee picker. */
  people: Person[];
  /** The sprints seen on this project's issues, open ones first. */
  sprints: Sprint[];
  /** What a new issue can be, in each project of the workspace, by its key. */
  issueTypes: Record<string, IssueType[]>;
  savedViews: SavedView[];
  prefs: Prefs;
  /** The lists and details being fetched now, by their keys. */
  loading: string[];
}

/** A change to put back: what the field was, and what this tab made it, so Undo leaves it if someone changed it since. */
export type Undo =
  | { kind: "status"; key: string; from: string; to: string }
  | { kind: "assignee"; key: string; from: Person | null; to: Person | null }
  | { kind: "labels"; key: string; added: string[]; removed: string[] };

/** The writes the tab makes; the first three happen at once, with Undo, and the rest after the user confirms. */
export type WriteAction =
  | { kind: "transition"; key: string; status: string }
  | { kind: "assign"; key: string; to: Person | null }
  | { kind: "labels"; key: string; add: string[]; remove: string[] }
  | { kind: "comment"; key: string; markdown: string }
  | { kind: "summary"; key: string; summary: string }
  | { kind: "description"; key: string; markdown: string }
  | { kind: "create"; project: string; type: string; summary: string; markdown: string; labels: string[]; parent: string | null; assignToMe: boolean };

export type TabAction =
  | { kind: "connect"; project: string }
  | { kind: "disconnect" }
  /** A timer's read waits out a longer gap, as every kept conversation's hidden frame runs one; a forced read waits for none. */
  | { kind: "refresh"; jql: string; counts: boolean; by?: "timer" | "user"; force?: boolean }
  | { kind: "open"; key: string }
  | { kind: "prefs"; prefs: Prefs }
  | { kind: "save-view"; name: string; jql: string }
  | { kind: "remove-view"; name: string }
  | { kind: "find-sprints" }
  | { kind: "look-up-project"; project: string }
  | { kind: "add-source"; name: string; project: string; filter: string }
  | { kind: "remove-source"; name: string }
  | { kind: "undo"; undo: Undo }
  | WriteAction;

export interface WriteReply {
  done: true;
  undo: Undo | null;
  /** The key of an issue it created. */
  key?: string;
}
