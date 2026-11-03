import type { CanvasHost } from "./mirador/api.ts";
import { JiraTab } from "./jira/tab.ts";

/** The workspace's Jira project in a tab of its canvas, through the acli signed in on this computer. */
const host: CanvasHost = { items: {}, tools: {}, workspaceTab: new JiraTab() };

export default host;
