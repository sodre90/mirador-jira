import { expect, test } from "bun:test";
import { planText, workText } from "../jira/handoff.ts";
import { detailOf } from "../jira/normalize.ts";
import { fillTemplate, NO_OVERRIDES, PROMPTS, templateFor } from "../jira/prompts.ts";
import { FakeJira } from "./fake-acli.ts";

const SITE = "https://kite.example.net";
const viewed = (key: string) => detailOf(JSON.parse(new FakeJira().answer("acli", ["jira", "workitem", "view", key, "--json"]).stdout))!;

test("the built-in messages read as they always have", () => {
  const described = viewed("KITE-412");
  const epic = viewed("KITE-9");
  const children = [viewed("KITE-412"), viewed("KITE-398"), viewed("KITE-360")];
  expect({
    workDescribed: workText(described, described, SITE),
    workBare: workText(described, null, SITE),
    planWithOpen: planText(epic, epic, children, SITE),
    planAllDone: planText(epic, null, [viewed("KITE-360")], SITE),
  }).toMatchSnapshot();
});

test("an issue's own braces stay as written, and this workspace's text wins over every workspace's", () => {
  expect(fillTemplate("{summary} {nobody}", { summary: "Read /v4/{id} and {key}" })).toBe("Read /v4/{id} and {key} {nobody}");
  expect(templateFor("work", NO_OVERRIDES)).toBe(PROMPTS.work.builtIn);
  const issue = viewed("KITE-398");
  expect(workText(issue, null, SITE, { workspace: { work: "Here {key}" }, every: { work: "Every {key}" } })).toBe("Here KITE-398");
  expect(workText(issue, null, SITE, { workspace: {}, every: { work: "Every {key}\n\nIts description:\n{description}" } })).toBe("Every KITE-398");
});
