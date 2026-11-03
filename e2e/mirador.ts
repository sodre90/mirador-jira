import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Mirador's checkout, whose test host and helpers the specs use; by default it sits next to this one. */
export const miradorDir = process.env.MIRADOR_DIR ?? join(import.meta.dirname, "..", "..", "visualized-claude-sessions");
/** The plugin as the specs install it: scripts/e2e.sh builds a copy, so the owner's own Mirador never runs a test's build. */
const pluginDir = process.env.JIRA_PLUGIN_DIR ?? join(import.meta.dirname, "..");

type Helpers = typeof import("../../visualized-claude-sessions/e2e/helpers.ts");
type TestHostModule = typeof import("../../visualized-claude-sessions/e2e/test-host.ts");
export type TestHost = InstanceType<TestHostModule["TestHost"]>;

let loadedHelpers: Helpers | null = null;
export const helpers = () => {
  if (!loadedHelpers) throw new Error("Start the host first.");
  return loadedHelpers;
};

/**
 * A started Mirador test host with this plugin, a project folder whose git history names Kite's issue keys, an acli on
 * the host's PATH that answers from the fake Jira in tests/fake-acli.ts (its state in `stateFile`, its calls in `acliLog`),
 * and an opencode stand-in that writes each prompt to `promptsFile`.
 */
export async function startHostWithThisPlugin() {
  const { TestHost, writeBunProgram } = (await import(join(miradorDir, "e2e", "test-host.ts"))) as TestHostModule;
  loadedHelpers = (await import(join(miradorDir, "e2e", "helpers.ts"))) as Helpers;
  const host = new TestHost({ fakePrograms: true });
  const promptsFile = join(host.root, "prompts");
  const stateFile = join(host.root, "jira-state.json");
  const acliLog = join(host.root, "acli-calls");
  writeBunProgram(host.fakeProgramsDir, "opencode", join(miradorDir, "e2e", "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
  writeBunProgram(host.fakeProgramsDir, "acli", join(pluginDir, "tests", "fake-acli-program.ts"), { FAKE_ACLI_STATE: stateFile, FAKE_ACLI_LOG: acliLog });
  writeFileSync(promptsFile, "");
  writeFileSync(acliLog, "");
  mkdirSync(join(host.dataDir, "plugins"), { recursive: true });
  symlinkSync(pluginDir, join(host.dataDir, "plugins", "jira"));
  mkdirSync(host.projectDir, { recursive: true });
  seedKiteHistory(host.projectDir);
  await host.start();
  return { host, promptsFile, stateFile, acliLog };
}

/** A git repo of Kite, a note-taking app nobody makes, whose branches and commits name its Jira issues. */
function seedKiteHistory(folder: string) {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: folder });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Dana");
  git("config", "user.email", "dana@example.invalid");
  ["KITE-360 Show a banner while offline", "KITE-377 Export notes as Markdown", "KITE-412 Keep notes when a folder is renamed"].forEach((message) => git("commit", "-q", "--allow-empty", "-m", message));
  git("branch", "kite-421-accents");
}
