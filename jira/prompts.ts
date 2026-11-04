import { adfToText } from "./adf.ts";
import type { Detail, Issue } from "./model.ts";

export type PromptKind = "work" | "plan";

/** The user's own text for a message, this workspace's and every workspace's; a level without one uses the next. */
export interface PromptOverrides {
  workspace: Partial<Record<PromptKind, string>>;
  every: Partial<Record<PromptKind, string>>;
}

export type PromptScope = keyof PromptOverrides;

export const NO_OVERRIDES: PromptOverrides = { workspace: {}, every: {} };

interface Placeholder {
  name: string;
  means: string;
}

interface Prompt {
  name: string;
  /** Which of the tab's buttons sends it, as a sentence. */
  sentBy: string;
  placeholders: Placeholder[];
  builtIn: string;
}

const ISSUE: Placeholder[] = [
  { name: "key", means: "the issue's key, such as KITE-412" },
  { name: "summary", means: "its summary" },
  { name: "url", means: "its page in Jira" },
  { name: "type", means: "its type, in lower case" },
  { name: "status", means: "its status" },
  { name: "facts", means: "its type, status, priority and parent, in a few words" },
  { name: "description", means: "its description as plain text, the first 6000 characters" },
];

const READ_IT = "Read it and its comments with `acli jira workitem view {key} --fields '*navigable,comment' --json`.";

const ASK_FIRST = "Jira tells the issue's watchers of every change, so ask me before you comment on it, move it to another status or change it in any other way.";

export const PROMPTS: Record<PromptKind, Prompt> = {
  work: {
    name: "Work on an issue",
    sentBy: "Work on this sends it for an issue.",
    placeholders: ISSUE,
    builtIn: ["Work on the Jira issue {key}: {summary} ({facts}). {url}", "Its description:\n{description}", `${READ_IT} Name the branch and the commits after {key}. ${ASK_FIRST}`].join("\n\n"),
  },
  plan: {
    name: "Plan an epic",
    sentBy: "Plan with the agent sends it, for an epic.",
    placeholders: [...ISSUE, { name: "children", means: "what's under it and not done, as a list, or that nothing is" }],
    builtIn: ["Look at the Jira {type} {key}: {summary}. {url}", "Its description:\n{description}", "{children}", `Suggest what to do next, in what order, and what's missing. ${READ_IT} ${ASK_FIRST}`].join("\n\n"),
  },
};

export const PROMPT_KINDS = Object.keys(PROMPTS) as PromptKind[];

/** The text a level starts from when it has none of its own. */
export function inheritedTemplate(kind: PromptKind, overrides: PromptOverrides, scope: PromptScope): string {
  return (scope === "workspace" ? overrides.every[kind] : undefined) ?? PROMPTS[kind].builtIn;
}

export const templateFor = (kind: PromptKind, overrides: PromptOverrides) => overrides.workspace[kind] ?? inheritedTemplate(kind, overrides, "workspace");

/** Where the text in use comes from, for the sheet to say. */
export const templateSource = (kind: PromptKind, overrides: PromptOverrides): "workspace" | "every" | "built-in" =>
  overrides.workspace[kind] !== undefined ? "workspace" : overrides.every[kind] !== undefined ? "every" : "built-in";

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * The template with its placeholders filled in one pass, so braces in an item's own text stay as they are, and unknown
 * names stay as written. A paragraph whose placeholders all came out empty is left out.
 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template
    .split(/\n{2,}/)
    .flatMap((paragraph) => {
      const names = [...paragraph.matchAll(PLACEHOLDER)].map(([, name]) => name!).filter((name) => name in values);
      if (names.length > 0 && names.every((name) => !values[name]!.trim())) return [];
      return [paragraph.replace(PLACEHOLDER, (written, name: string) => (name in values ? values[name]! : written))];
    })
    .join("\n\n")
    .trim();
}

const MOST_DESCRIPTION_CHARS = 6000;

export const issueUrl = (site: string, key: string) => `${site}/browse/${key}`;

function descriptionOf(detail: Detail | null) {
  const text = adfToText(detail?.description).trim();
  return text.length > MOST_DESCRIPTION_CHARS ? `${text.slice(0, MOST_DESCRIPTION_CHARS)}…` : text;
}

/** What every placeholder of an issue stands for. */
export function issueValues(issue: Issue, detail: Detail | null, site: string): Record<string, string> {
  return {
    key: issue.key,
    summary: issue.summary,
    url: issueUrl(site, issue.key),
    type: issue.type.toLowerCase(),
    status: issue.status.name,
    facts: [issue.type, issue.status.name, issue.priority && `priority ${issue.priority}`, detail?.parent && `under ${detail.parent.key} (${detail.parent.summary})`].filter(Boolean).join(", "),
    description: descriptionOf(detail),
  };
}

export function planValues(issue: Issue, detail: Detail | null, children: Issue[], site: string): Record<string, string> {
  const open = children.filter(({ status }) => status.category !== "done");
  const list = open.map((child) => `- ${child.key} (${child.summary}): ${child.status.name}${child.assignee ? `, ${child.assignee.name}` : ""}`).join("\n");
  return { ...issueValues(issue, detail, site), children: open.length ? `What's under it and not done:\n${list}` : "Nothing under it is open." };
}

/** One level's stored texts, as far as they are texts of known messages. */
export function promptLevelOf(value: unknown): Partial<Record<PromptKind, string>> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter(([kind, text]) => kind in PROMPTS && typeof text === "string")) as Partial<Record<PromptKind, string>>;
}

/**
 * The level as it is with the text set, or taken out with null. A text the same as what the level would inherit is
 * taken out too, so a later change to the built-in, or to every workspace's, still reaches it.
 */
export function withPrompt(overrides: PromptOverrides, scope: PromptScope, kind: PromptKind, text: string | null): Partial<Record<PromptKind, string>> {
  const { [kind]: _left, ...rest } = overrides[scope];
  if (text === null || text.trim() === inheritedTemplate(kind, overrides, scope).trim()) return rest;
  return { ...rest, [kind]: text };
}
