import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { helpers, startHostWithThisPlugin, type TestHost } from "./mirador.ts";

let host: TestHost;
let promptsFile: string;
let stateFile: string;
let acliLog: string;
const freshJira = () => ({ issues: [], signedIn: true, nextKey: 431, nextComment: 10003 });
const agentSaw = () => readFileSync(promptsFile, "utf8");
const acliCalls = () => readFileSync(acliLog, "utf8");
type Stored = { key: string; status: { name: string }; assignee: { accountId: string } | null; comments: unknown[]; summary: string };
const jiraIssue = (key: string) => (JSON.parse(readFileSync(stateFile, "utf8")) as { issues: Stored[] }).issues.find((issue) => issue.key === key);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  ({ host, promptsFile, stateFile, acliLog } = await startHostWithThisPlugin());
});
test.afterAll(async () => {
  await host?.stop();
  await host?.cleanUp();
});

const tab = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-frame.workspace-tab iframe");
const sheet = (page: Page) => tab(page).getByRole("dialog");
const toast = (page: Page) => tab(page).locator(".toast");
const view = (page: Page, name: string) => tab(page).locator(".views").getByRole("tab", { name: new RegExp(`^${name}`) });
const row = (page: Page, key: string) => tab(page).locator(`.row[data-key="${key}"]`);
const rows = (page: Page) => tab(page).locator(".list .row");
const column = (page: Page, name: string) => tab(page).getByRole("region", { name });
const card = (page: Page, key: string) => tab(page).locator(`.card[data-key="${key}"]`);
const detail = (page: Page) => tab(page).locator(".detail");
const section = (page: Page, name: string) => detail(page).getByRole("tab", { name: new RegExp(`^${name}`) });
/** With JIRA_SCREENSHOTS naming a folder, the canvas pane as the step leaves it, for the README and for a look. */
const shoot = async (page: Page, name: string) => {
  const folder = process.env.JIRA_SCREENSHOTS;
  if (folder) await page.locator(".canvas-panel:visible").screenshot({ path: join(folder, `${name}.png`) });
};

async function openConversation(page: Page) {
  const { addWorkspace, createProfile, signIn } = helpers();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "jira", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "jira · opencode" });
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
}

test("a workspace connects to its Jira project, and its issues are found, read, changed and handed to the agent", async ({ page }) => {
  await openConversation(page);

  await test.step("the tab offers the project the git history names and connects once the user confirms", async () => {
    await page.locator(".canvas-panel:visible .workspace-tab-toggle", { hasText: "Jira" }).click();
    await expect(tab(page).getByRole("heading", { name: "Connect this workspace to Jira" })).toBeVisible();
    await expect(tab(page).getByRole("radio", { name: /KITE/ })).toBeChecked();
    writeFileSync(stateFile, JSON.stringify({ ...freshJira(), signedIn: false }));
    await tab(page).getByRole("button", { name: "Connect" }).click();
    await expect(tab(page).getByRole("heading", { name: "acli isn't signed in to Jira" })).toBeVisible();
    await expect(tab(page).locator(".fix .command")).toHaveText("acli jira auth login --web");
    rmSync(stateFile);
    await tab(page).getByRole("button", { name: "Connect" }).click();
    await expect.poll(acliCalls, { message: "the host never ran the fake acli: is it on the host's PATH?", timeout: 10_000 }).toContain('"auth","status"');
    await expect(row(page, "KITE-412")).toBeVisible();
  });

  await test.step("Mine lists my open issues, with counts on the views", async () => {
    await expect(rows(page)).toHaveCount(2);
    await expect(row(page, "KITE-421")).toContainText("Search misses words with accents");
    await expect(view(page, "Mine")).toContainText("2");
    await shoot(page, "mine");
  });

  await test.step("the search box finds words, and Esc brings the view back", async () => {
    const search = tab(page).locator("#jira-search");
    await search.fill("accents");
    await search.press("Enter");
    await expect(rows(page)).toHaveCount(1);
    await expect(row(page, "KITE-421")).toBeVisible();
    await search.press("Escape");
    await expect(rows(page)).toHaveCount(2);
  });

  await test.step("a search Jira can't read says so, and the dot beside it turns red", async () => {
    const search = tab(page).locator("#jira-search");
    const dot = tab(page).locator(".live i");
    const readColor = await dot.evaluate((element) => getComputedStyle(element).backgroundColor);
    await search.fill("labels = sync AND (");
    await search.press("Enter");
    await expect(tab(page).locator(".problem-line")).toContainText("Jira can't read this JQL");
    await expect(tab(page).locator(".live")).toContainText("Couldn't read Jira");
    await expect.poll(() => dot.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(readColor);
    await search.press("Escape");
    await expect(rows(page)).toHaveCount(2);
    await expect.poll(() => dot.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(readColor);
  });

  await test.step("an issue opens with its description, links and comments", async () => {
    await row(page, "KITE-412").click();
    await expect(detail(page).getByRole("heading", { name: "Notes vanish after renaming a folder" })).toBeVisible();
    await expect(detail(page)).toContainText("Turn on airplane mode");
    await expect(detail(page).locator(".crumbs")).toContainText("KITE-9 Offline mode");
    await section(page, "Links").click();
    await expect(detail(page).locator(".link-group", { hasText: "Is blocked by" })).toContainText("Queue edits made offline and replay them");
    await section(page, "Activity").click();
    await expect(detail(page).locator(".comment", { hasText: "Lee Park" })).toContainText("Happens on Android too.");
    await expect(detail(page).locator(".comment").nth(1)).toContainText("Looks like the rename replays after the moves.");
    await shoot(page, "detail");
  });

  await test.step("moving it to another status happens at once, and Undo moves it back", async () => {
    await detail(page).getByRole("button", { name: /^status/i }).click();
    await detail(page).getByRole("option", { name: "In Review" }).click();
    await expect(detail(page).locator(".fields .lozenge").first()).toHaveText("In Review");
    await expect.poll(() => jiraIssue("KITE-412")?.status.name).toBe("In Review");
    await expect(toast(page)).toContainText("KITE-412 (Notes vanish after renaming a folder) is In Review");
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => jiraIssue("KITE-412")?.status.name).toBe("In Progress");
    await expect(detail(page).locator(".fields .lozenge").first()).toHaveText("In Progress");
  });

  await test.step("a comment shows the command it runs, goes to Jira and shows in the activity", async () => {
    await tab(page).locator("#comment-text").fill("The rename replays **after** the moves, so order them first.");
    await expect(detail(page).locator(".comment-buttons code")).toContainText("acli jira workitem comment create --key KITE-412");
    await detail(page).getByRole("button", { name: "Comment in Jira" }).click();
    await expect.poll(() => jiraIssue("KITE-412")?.comments.length).toBe(3);
    await expect(detail(page).locator(".comment")).toHaveCount(3);
    await expect(detail(page).locator(".comment").last()).toContainText("so order them first");
  });

  await test.step("assigning myself an unassigned issue happens at once, and Undo leaves it unassigned", async () => {
    await section(page, "Links").click();
    await detail(page).getByRole("button", { name: /Queue edits made offline and replay them/ }).click();
    await expect(detail(page).getByRole("heading", { name: "Queue edits made offline and replay them" })).toBeVisible();
    await detail(page).getByRole("button", { name: /^assignee/i }).click();
    await detail(page).getByRole("button", { name: /Assign to me/ }).click();
    await expect.poll(() => jiraIssue("KITE-398")?.assignee?.accountId).toBe("acct-dana");
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => jiraIssue("KITE-398")?.assignee ?? null).toBeNull();
  });

  await test.step("assigning someone else asks first, with the command", async () => {
    await detail(page).getByRole("button", { name: /^assignee/i }).click();
    await detail(page).getByRole("button", { name: /Lee Park/ }).click();
    await expect(sheet(page).locator(".command")).toContainText("acli jira workitem assign --key KITE-398");
    await sheet(page).getByRole("button", { name: "Cancel" }).click();
    expect(jiraIssue("KITE-398")?.assignee ?? null).toBeNull();
  });

  await test.step("a new issue shows its command, and opens once Jira made it", async () => {
    await tab(page).getByRole("button", { name: "+ New" }).click();
    await sheet(page).getByLabel("Summary").fill("Sync notes over Wi-Fi only");
    await expect(sheet(page).locator(".command")).toContainText("acli jira workitem create --project KITE");
    await sheet(page).getByRole("button", { name: "Create in Jira" }).click();
    await expect(toast(page)).toContainText("Created KITE-431 (Sync notes over Wi-Fi only)");
    expect(jiraIssue("KITE-431")?.summary).toBe("Sync notes over Wi-Fi only");
    await expect(detail(page).getByRole("heading", { name: "Sync notes over Wi-Fi only" })).toBeVisible();
    await expect(row(page, "KITE-431")).toBeVisible();
  });

  await test.step("an escalation project joins the workspace, only for its component, with a view of its own", async () => {
    await detail(page).getByRole("button", { name: "Close the issue's panel" }).click();
    await tab(page).getByRole("button", { name: "More", exact: true }).click();
    await tab(page).getByRole("button", { name: "Sources…" }).click();
    await sheet(page).getByLabel("Project key").fill("SUP");
    await sheet(page).getByRole("button", { name: "Look it up" }).click();
    await expect(sheet(page)).toContainText("SUP is Kite support.");
    await sheet(page).getByLabel("Component", { exact: true }).selectOption("Kite");
    await expect(sheet(page).getByLabel("View name")).toHaveValue("SUP · Kite");
    await sheet(page).getByLabel("View name").fill("Escalations");
    await expect(sheet(page).locator(".jql")).toHaveText('project = SUP AND (component = "Kite")');
    await shoot(page, "sources");
    await sheet(page).getByRole("button", { name: "Add the source" }).click();
    await expect(toast(page)).toContainText("Added Escalations: 2 issues");
    await expect(view(page, "Escalations")).toHaveAttribute("aria-selected", "true");
    await expect(view(page, "Escalations")).toContainText("2");
    await expect(rows(page)).toHaveCount(2);
    await expect(row(page, "SUP-21")).toContainText("A customer's notes vanish after renaming a folder");
    await shoot(page, "escalations");
  });

  await test.step("a new issue from the source's view goes in its project, with that project's types", async () => {
    await tab(page).getByRole("button", { name: "+ New" }).click();
    await expect(sheet(page).getByLabel("Project", { exact: true })).toHaveValue("SUP");
    await expect(sheet(page).getByLabel("Type", { exact: true })).toHaveValue("Escalation");
    await sheet(page).getByLabel("Project", { exact: true }).selectOption("KITE");
    await expect(sheet(page).getByLabel("Type", { exact: true })).toHaveValue("Task");
    await sheet(page).getByRole("button", { name: "Cancel" }).click();
  });

  await test.step("Mine takes in my escalations of the component, and no other", async () => {
    await view(page, "Mine").click();
    await expect(row(page, "SUP-21")).toBeVisible();
    await expect(row(page, "KITE-412")).toBeVisible();
    await expect(row(page, "SUP-22")).toHaveCount(0);
    await row(page, "SUP-21").click();
    await expect(detail(page).locator(".crumbs")).toHaveText("Kite support");
    await detail(page).getByRole("button", { name: "Close the issue's panel" }).click();
  });

  await test.step("Mine sorts by priority, and keeps that order when it's shown again", async () => {
    const keys = () => rows(page).evaluateAll((found) => found.map((each) => (each as HTMLElement).dataset.key));
    await tab(page).getByRole("button", { name: "Sort: Last updated ▾" }).click();
    await tab(page).getByRole("option", { name: "Priority" }).click();
    await expect.poll(keys).toEqual(["KITE-412", "KITE-431", "KITE-421", "SUP-21"]);
    await expect(row(page, "KITE-412").getByRole("img", { name: "High priority" })).toHaveText("↑");
    await view(page, "Recent").click();
    await expect(tab(page).locator(".sort-bar")).toHaveCount(0);
    await view(page, "Mine").click();
    await expect(tab(page).getByRole("button", { name: "Sort: Priority ▾" })).toBeVisible();
    await expect.poll(keys).toEqual(["KITE-412", "KITE-431", "KITE-421", "SUP-21"]);
    await expect(view(page, "Mine")).toContainText("4");
  });

  await test.step("the Sprint view shows the active sprint as a board, and dropping a card moves it", async () => {
    await view(page, "Sprint").click();
    await expect(column(page, "Waiting for support")).toHaveCount(0);
    await expect(tab(page).locator(".sprint-bar")).toContainText("Kite sprint 7");
    await expect(column(page, "To Do").locator('.card[data-key="KITE-398"]')).toBeVisible();
    await expect(column(page, "In Review").locator('.card[data-key="KITE-377"]')).toBeVisible();
    await card(page, "KITE-398").dragTo(column(page, "In Progress"));
    await expect(column(page, "In Progress").locator('.card[data-key="KITE-398"]')).toBeVisible();
    await expect.poll(() => jiraIssue("KITE-398")?.status.name).toBe("In Progress");
  });

  await test.step("a status with no cards folds to a strip, and a card dropped on it moves there", async () => {
    await card(page, "KITE-377").dragTo(column(page, "In Progress"));
    await expect(column(page, "In Review")).toHaveClass(/folded/);
    expect((await column(page, "In Review").boundingBox())!.width).toBeLessThan(50);
    await shoot(page, "sprint");
    await card(page, "KITE-377").dragTo(column(page, "In Review"));
    await expect(column(page, "In Review").locator('.card[data-key="KITE-377"]')).toBeVisible();
    await expect.poll(() => jiraIssue("KITE-377")?.status.name).toBe("In Review");
  });

  await test.step("Work on this mentions the issue in the composer, or sends it to the conversation's agent", async () => {
    await card(page, "KITE-412").locator(".card-open").click();
    await detail(page).getByRole("button", { name: "More ways to hand it to the agent" }).click();
    await detail(page).getByRole("button", { name: /Mention in the composer/ }).click();
    await expect(page.locator(".composer:visible textarea")).toHaveValue(/KITE-412 \(Notes vanish after renaming a folder\)/);
    await detail(page).getByRole("button", { name: "More ways to hand it to the agent" }).click();
    await detail(page).getByRole("button", { name: /Send to this conversation/ }).click();
    await expect.poll(agentSaw).toContain("KITE-412");
    expect(agentSaw()).toContain("acli jira workitem view KITE-412");
    expect(agentSaw()).toContain("ask me before you comment on it");
  });

  await test.step("once acli is signed out, the tab says how to sign in again", async () => {
    writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(readFileSync(stateFile, "utf8")), signedIn: false }));
    await expect(async () => {
      await tab(page).getByRole("button", { name: "More", exact: true }).click();
      await tab(page).getByRole("button", { name: /Read again/ }).click();
      await expect(tab(page).getByRole("heading", { name: "acli isn't signed in to Jira" })).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    await expect(tab(page).locator(".command")).toHaveText("acli jira auth login --web");
  });
});
