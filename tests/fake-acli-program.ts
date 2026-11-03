import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { FakeJira, freshState } from "./fake-acli.ts";

/** The fake Jira as a program named acli, for the e2e: its state lives in FAKE_ACLI_STATE, and each call is logged to FAKE_ACLI_LOG. */
const stateFile = process.env.FAKE_ACLI_STATE!;
const logFile = process.env.FAKE_ACLI_LOG!;
const args = process.argv.slice(2);
const before = existsSync(stateFile) ? readFileSync(stateFile, "utf8") : JSON.stringify(freshState());
const jira = new FakeJira(JSON.parse(before));
const ran = jira.answer("acli", args);
const after = JSON.stringify(jira.state);
// The tab runs up to three acli at once: only a call that changed Jira writes the state, so a read never puts back an older one.
if (after !== before) {
  writeFileSync(`${stateFile}.${process.pid}`, after);
  renameSync(`${stateFile}.${process.pid}`, stateFile);
}
appendFileSync(logFile, `${JSON.stringify(args)}\n`);
process.stdout.write(ran.stdout);
process.stderr.write(ran.stderr);
process.exitCode = ran.code;
