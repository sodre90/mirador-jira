/** A made-up Jira: Kite, a note-taking app, on a site nobody runs. Nothing here is real. */

export const SITE = "kite.example.com";
export const PROJECT = "KITE";

export interface FakePerson {
  accountId: string;
  displayName: string;
  emailAddress: string | null;
}

export const DANA: FakePerson = { accountId: "acct-dana", displayName: "Dana Reyes", emailAddress: "dana@kite.example.com" };
export const LEE: FakePerson = { accountId: "acct-lee", displayName: "Lee Park", emailAddress: null };
export const SAM: FakePerson = { accountId: "acct-sam", displayName: "Sam Okafor", emailAddress: "sam@kite.example.com" };
export const ME = DANA;

export const STATUSES = {
  todo: { name: "To Do", category: "new" },
  progress: { name: "In Progress", category: "indeterminate" },
  review: { name: "In Review", category: "indeterminate" },
  done: { name: "Done", category: "done" },
} as const;

export type FakeStatus = (typeof STATUSES)[keyof typeof STATUSES];

/** Which statuses each can move to, as a workflow allows: Done only goes back through To Do. */
export const WORKFLOW: Record<string, string[]> = {
  "To Do": ["In Progress", "Done"],
  "In Progress": ["To Do", "In Review", "Done"],
  "In Review": ["In Progress", "Done"],
  Done: ["To Do"],
};

export const SPRINT_7 = { id: 7007, name: "Kite sprint 7", state: "active", boardId: 77, startDate: "2026-10-27T09:00:00.000Z", endDate: "2026-11-07T17:00:00.000Z", goal: "" };
export const SPRINT_8 = { id: 7008, name: "Kite sprint 8", state: "future", boardId: 77, endDate: "2026-11-21T17:00:00.000Z", goal: "" };

export interface FakeComment {
  id: string;
  author: FakePerson;
  body: unknown;
  created: string;
  updated: string;
}

export interface FakeIssue {
  key: string;
  summary: string;
  type: string;
  status: FakeStatus;
  priority: string;
  assignee: FakePerson | null;
  reporter: FakePerson;
  labels: string[];
  description: unknown;
  parent: string | null;
  sprint: number | null;
  watchers: string[];
  links: { type: string; inward: string; outward: string; to: string; outwardFromHere: boolean }[];
  comments: FakeComment[];
  created: string;
  updated: string;
}

const paragraph = (...texts: string[]) => ({ type: "paragraph", content: texts.map((text) => ({ type: "text", text })) });
const adf = (...content: unknown[]) => ({ version: 1, type: "doc", content });

export const ISSUES: FakeIssue[] = [
  {
    key: "KITE-9",
    summary: "Offline mode",
    type: "Epic",
    status: STATUSES.progress,
    priority: "High",
    assignee: SAM,
    reporter: SAM,
    labels: [],
    description: adf(paragraph("Notes open, change and sync later when the phone has no connection.")),
    parent: null,
    sprint: null,
    watchers: [SAM.accountId],
    links: [],
    comments: [],
    created: "2026-09-01T10:00:00.000+0000",
    updated: "2026-10-30T10:00:00.000+0000",
  },
  {
    key: "KITE-412",
    summary: "Notes vanish after renaming a folder",
    type: "Bug",
    status: STATUSES.progress,
    priority: "High",
    assignee: DANA,
    reporter: LEE,
    labels: ["sync"],
    description: adf(
      paragraph("Rename a folder while offline, then reconnect: its notes are gone from the list."),
      { type: "orderedList", content: ["Turn on airplane mode", "Rename a folder", "Turn it off"].map((step) => ({ type: "listItem", content: [paragraph(step)] })) },
      { type: "paragraph", content: [{ type: "text", text: "Seen on " }, { type: "text", text: "1.8.2", marks: [{ type: "code" }] }, { type: "text", text: "." }] },
    ),
    parent: "KITE-9",
    sprint: SPRINT_7.id,
    watchers: [DANA.accountId, LEE.accountId],
    links: [{ type: "Blocks", inward: "is blocked by", outward: "blocks", to: "KITE-398", outwardFromHere: false }],
    comments: [
      { id: "10001", author: LEE, body: adf(paragraph("Happens on Android too.")), created: "2026-11-02T09:15:00.000+0000", updated: "2026-11-02T09:15:00.000+0000" },
      {
        id: "10002",
        author: DANA,
        body: adf({ type: "paragraph", content: [{ type: "text", text: "Looks like the rename replays " }, { type: "text", text: "after", marks: [{ type: "strong" }] }, { type: "text", text: " the moves." }] }),
        created: "2026-11-02T11:40:00.000+0000",
        updated: "2026-11-02T11:40:00.000+0000",
      },
    ],
    created: "2026-10-28T08:00:00.000+0000",
    updated: "2026-11-02T11:40:00.000+0000",
  },
  {
    key: "KITE-398",
    summary: "Queue edits made offline and replay them",
    type: "Task",
    status: STATUSES.todo,
    priority: "Medium",
    assignee: null,
    reporter: SAM,
    labels: ["sync"],
    description: adf(paragraph("Every edit goes into a queue first; the queue replays in order once the connection is back.")),
    parent: "KITE-9",
    sprint: SPRINT_7.id,
    watchers: [],
    links: [{ type: "Blocks", inward: "is blocked by", outward: "blocks", to: "KITE-412", outwardFromHere: true }],
    comments: [],
    created: "2026-10-20T08:00:00.000+0000",
    updated: "2026-10-31T08:00:00.000+0000",
  },
  {
    key: "KITE-377",
    summary: "Export notes as Markdown",
    type: "Story",
    status: STATUSES.review,
    priority: "Medium",
    assignee: LEE,
    reporter: DANA,
    labels: ["export"],
    description: adf(paragraph("A notebook exports as a folder of Markdown files, one per note.")),
    parent: null,
    sprint: SPRINT_7.id,
    watchers: [DANA.accountId],
    links: [],
    comments: [],
    created: "2026-10-15T08:00:00.000+0000",
    updated: "2026-11-01T08:00:00.000+0000",
  },
  {
    key: "KITE-360",
    summary: "Show a banner while offline",
    type: "Task",
    status: STATUSES.done,
    priority: "Low",
    assignee: DANA,
    reporter: SAM,
    labels: ["ui"],
    description: null,
    parent: "KITE-9",
    sprint: SPRINT_7.id,
    watchers: [],
    links: [],
    comments: [],
    created: "2026-10-10T08:00:00.000+0000",
    updated: "2026-10-29T08:00:00.000+0000",
  },
  {
    key: "KITE-421",
    summary: "Search misses words with accents",
    type: "Bug",
    status: STATUSES.todo,
    priority: "Medium",
    assignee: DANA,
    reporter: SAM,
    labels: ["search"],
    description: adf({ type: "paragraph", content: [{ type: "text", text: "Searching cafe doesn't find café. " }, { type: "mention", attrs: { id: LEE.accountId, text: "@Lee Park" } }, { type: "text", text: " knows the index." }] }),
    parent: null,
    sprint: null,
    watchers: [DANA.accountId],
    links: [],
    comments: [],
    created: "2026-11-01T08:00:00.000+0000",
    updated: "2026-11-01T08:00:00.000+0000",
  },
  {
    key: "KITE-430",
    summary: "Share a notebook by link",
    type: "Story",
    status: STATUSES.todo,
    priority: "Low",
    assignee: SAM,
    reporter: DANA,
    labels: [],
    description: null,
    parent: null,
    sprint: SPRINT_8.id,
    watchers: [],
    links: [],
    comments: [],
    created: "2026-10-05T08:00:00.000+0000",
    updated: "2026-10-25T08:00:00.000+0000",
  },
];

export const ISSUE_TYPES = [
  { name: "Epic", subtask: false },
  { name: "Story", subtask: false },
  { name: "Task", subtask: false },
  { name: "Bug", subtask: false },
  { name: "Sub-task", subtask: true },
];
