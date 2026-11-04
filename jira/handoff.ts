import type { Detail, Issue } from "./model.ts";
import { fillTemplate, issueUrl, issueValues, NO_OVERRIDES, planValues, templateFor, type PromptOverrides } from "./prompts.ts";

export { issueUrl };

export const mentionText = (issue: Issue, site: string) => `${issue.key} (${issue.summary}) ${issueUrl(site, issue.key)}`;

/** A conversation's first message, to work on the issue: what it is, where to read more, and how to treat Jira. */
export const workText = (issue: Issue, detail: Detail | null, site: string, overrides: PromptOverrides = NO_OVERRIDES) => fillTemplate(templateFor("work", overrides), issueValues(issue, detail, site));

/** To plan an epic or a parent with its children: what's under it, and which aren't done. */
export const planText = (issue: Issue, detail: Detail | null, children: Issue[], site: string, overrides: PromptOverrides = NO_OVERRIDES) =>
  fillTemplate(templateFor("plan", overrides), planValues(issue, detail, children, site));
