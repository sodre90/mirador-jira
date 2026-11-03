import { adfToText } from "./adf.ts";
import type { Detail, Issue } from "./model.ts";

const MOST_DESCRIPTION_CHARS = 6000;

export const issueUrl = (site: string, key: string) => `${site}/browse/${key}`;

export const mentionText = (issue: Issue, site: string) => `${issue.key} (${issue.summary}) ${issueUrl(site, issue.key)}`;

const readIt = (key: string) => `Read it and its comments with \`acli jira workitem view ${key} --fields '*navigable,comment' --json\`.`;

const askFirst = "Jira tells the issue's watchers of every change, so ask me before you comment on it, move it to another status or change it in any other way.";

function described(detail: Detail | null) {
  const text = adfToText(detail?.description).trim();
  if (!text) return "";
  return `\n\nIts description:\n${text.length > MOST_DESCRIPTION_CHARS ? `${text.slice(0, MOST_DESCRIPTION_CHARS)}…` : text}`;
}

/** A conversation's first message, to work on the issue: what it is, where to read more, and how to treat Jira. */
export function workText(issue: Issue, detail: Detail | null, site: string): string {
  const facts = [issue.type, issue.status.name, issue.priority && `priority ${issue.priority}`, detail?.parent && `under ${detail.parent.key} (${detail.parent.summary})`].filter(Boolean).join(", ");
  return [
    `Work on the Jira issue ${issue.key}: ${issue.summary} (${facts}). ${issueUrl(site, issue.key)}${described(detail)}`,
    "",
    `${readIt(issue.key)} Name the branch and the commits after ${issue.key}. ${askFirst}`,
  ].join("\n");
}

/** To plan an epic or a parent with its children: what's under it, and which aren't done. */
export function planText(issue: Issue, detail: Detail | null, children: Issue[], site: string): string {
  const open = children.filter(({ status }) => status.category !== "done");
  const list = open.map((child) => `- ${child.key} (${child.summary}): ${child.status.name}${child.assignee ? `, ${child.assignee.name}` : ""}`).join("\n");
  return [
    `Look at the Jira ${issue.type.toLowerCase()} ${issue.key}: ${issue.summary}. ${issueUrl(site, issue.key)}${described(detail)}`,
    "",
    open.length ? `What's under it and not done:\n${list}` : "Nothing under it is open.",
    "",
    `Suggest what to do next, in what order, and what's missing. ${readIt(issue.key)} ${askFirst}`,
  ].join("\n");
}
