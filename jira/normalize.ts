import { isAdf } from "./adf.ts";
import type { Comment, Detail, Issue, Link, Person, Related, Sprint, Status, StatusCategory } from "./model.ts";

/** A work item as acli's JSON has it: Jira's REST shape, `fields` holding what was asked for. */
export interface RawIssue {
  key?: unknown;
  fields?: Record<string, unknown> | null;
}

type Raw = Record<string, unknown>;

const record = (value: unknown): Raw => (value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {});
const text = (value: unknown) => (typeof value === "string" ? value : "");
const textOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const CATEGORIES: StatusCategory[] = ["new", "indeterminate", "done"];

export function statusOf(value: unknown): Status {
  const status = record(value);
  const key = text(record(status.statusCategory).key);
  return { name: text(status.name) || "Unknown", category: CATEGORIES.includes(key as StatusCategory) ? (key as StatusCategory) : "new" };
}

export function personOf(value: unknown): Person | null {
  const person = record(value);
  const accountId = text(person.accountId);
  if (!accountId) return null;
  return { accountId, name: text(person.displayName) || accountId, email: textOrNull(person.emailAddress) };
}

export function issueOf(raw: RawIssue): Issue | null {
  const key = text(raw?.key);
  if (!key) return null;
  const fields = record(raw.fields);
  const type = record(fields.issuetype);
  return {
    key,
    summary: text(fields.summary),
    type: text(type.name) || "Issue",
    subtask: type.subtask === true,
    status: statusOf(fields.status),
    priority: textOrNull(record(fields.priority).name),
    assignee: personOf(fields.assignee),
    reporter: personOf(fields.reporter),
    labels: list(fields.labels).filter((label): label is string => typeof label === "string"),
  };
}

function relatedOf(value: unknown): Related | null {
  const related = record(value);
  const key = text(related.key);
  if (!key) return null;
  const fields = record(related.fields);
  return { key, summary: text(fields.summary), status: fields.status ? statusOf(fields.status) : null, type: textOrNull(record(fields.issuetype).name) };
}

/** Both sides of each link, in Jira's words for this issue's side. */
function linksOf(value: unknown): Link[] {
  return list(value).flatMap((entry) => {
    const link = record(entry);
    const type = record(link.type);
    const outward = relatedOf(link.outwardIssue);
    if (outward) return [{ ...outward, relation: text(type.outward) || text(type.name) }];
    const inward = relatedOf(link.inwardIssue);
    return inward ? [{ ...inward, relation: text(type.inward) || text(type.name) }] : [];
  });
}

function commentOf(value: unknown): Comment | null {
  const comment = record(value);
  const id = text(comment.id);
  if (!id) return null;
  return { id, author: personOf(comment.author), body: isAdf(comment.body) ? comment.body : null, created: text(comment.created), updated: text(comment.updated) || text(comment.created) };
}

const SPRINT_STATES: Sprint["state"][] = ["active", "future", "closed"];

function sprintOf(value: unknown): Sprint | null {
  const sprint = record(value);
  const id = Number(sprint.id);
  const state = text(sprint.state) as Sprint["state"];
  if (!Number.isFinite(id) || !SPRINT_STATES.includes(state)) return null;
  return { id, name: text(sprint.name) || `Sprint ${id}`, state, boardId: typeof sprint.boardId === "number" ? sprint.boardId : null, endDate: textOrNull(sprint.endDate) };
}

const looksLikeSprints = (value: unknown) => Array.isArray(value) && value.length > 0 && value.every((entry) => "boardId" in record(entry) && "state" in record(entry));

/** The sprint field has a site's own custom id, so it is the field whose value is a list of sprints. */
function sprintsOf(fields: Raw): Sprint[] {
  const field = Object.entries(fields).find(([name, value]) => name.startsWith("customfield_") && looksLikeSprints(value));
  return field ? list(field[1]).flatMap((entry) => sprintOf(entry) ?? []) : [];
}

const namesOf = (value: unknown) =>
  list(value)
    .map((entry) => text(record(entry).name))
    .filter(Boolean);

export function detailOf(raw: RawIssue): Detail | null {
  const issue = issueOf(raw);
  if (!issue) return null;
  const fields = record(raw.fields);
  return {
    ...issue,
    description: isAdf(fields.description) ? fields.description : null,
    created: text(fields.created),
    updated: text(fields.updated),
    resolution: textOrNull(record(fields.resolution).name),
    dueDate: textOrNull(fields.duedate),
    components: namesOf(fields.components),
    fixVersions: namesOf(fields.fixVersions),
    parent: relatedOf(fields.parent),
    subtasks: list(fields.subtasks).flatMap((entry) => relatedOf(entry) ?? []),
    links: linksOf(fields.issuelinks),
    comments: list(record(fields.comment).comments).flatMap((entry) => commentOf(entry) ?? []),
    sprints: sprintsOf(fields),
  };
}

/** What `acli jira auth status` says: the site and the account it is signed in as. */
export function authOf(output: string): { site: string; email: string | null } | null {
  if (!/authenticated/i.test(output)) return null;
  const site = /^\s*Site:\s*(\S+)/im.exec(output)?.[1];
  if (!site) return null;
  return { site: site.startsWith("http") ? site.replace(/\/+$/, "") : `https://${site}`, email: /^\s*Email:\s*(\S+)/im.exec(output)?.[1] ?? null };
}
