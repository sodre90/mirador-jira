import { useState } from "react";
import type { AcliProblem, TabState } from "../jira/model.ts";
import { failureText, send } from "./bridge.ts";
import { Spinner } from "./icons.tsx";

const copy = (text: string) => void navigator.clipboard?.writeText(text);

const FIXES: Partial<Record<AcliProblem["code"], { title: string; command: string; where: string }>> = {
  "not-installed": { title: "acli isn't installed", command: "brew tap atlassian/homebrew-acli && brew install acli", where: "in a terminal on this computer" },
  "not-signed-in": { title: "acli isn't signed in to Jira", command: "acli jira auth login --web", where: "in a terminal on this computer" },
};

/** What's wrong with acli, and the command that puts it right. */
function FixSteps({ problem }: { problem: AcliProblem }) {
  const fix = FIXES[problem.code]!;
  return (
    <div className="fix">
      <h3>{fix.title}</h3>
      <p className="muted">Run this {fix.where}, then connect again:</p>
      <pre className="command">{fix.command}</pre>
      <button type="button" className="link" onClick={() => copy(fix.command)}>
        Copy the command
      </button>
    </div>
  );
}

/** The workspace isn't connected yet: the projects its git history names, to pick one or type another. */
export function Connect({ state }: { state: TabState }) {
  const [picked, setPicked] = useState<string>(state.candidates[0]?.project ?? "");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const project = picked || typed.trim();
  const blocking = state.problem && FIXES[state.problem.code] ? state.problem : null;
  const connect = async () => {
    if (!project) return;
    setBusy(true);
    setProblem(null);
    try {
      await send({ kind: "connect", project });
    } catch (error) {
      setProblem(failureText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="center">
      <div className="panel connect">
        <h2>Connect this workspace to Jira</h2>
        <div className="choices" role="radiogroup" aria-label="Project">
          {state.candidates.slice(0, 4).map(({ project: key, mentions }) => (
            <label key={key}>
              <input type="radio" name="project" checked={picked === key} onChange={() => setPicked(key)} />
              <span>
                <b>{key}</b>
                <span className="muted small"> · named {mentions} {mentions === 1 ? "time" : "times"} in this folder's branches and commits</span>
              </span>
            </label>
          ))}
          <label>
            <input type="radio" name="project" checked={picked === ""} onChange={() => setPicked("")} />
            <span className="grow">
              {state.candidates.length ? "Another project: " : "Project key: "}
              <input
                className="inline-input"
                aria-label="Project key"
                placeholder="like KITE"
                value={typed}
                onFocus={() => setPicked("")}
                onChange={(event) => setTyped(event.target.value.toUpperCase())}
                onKeyDown={(event) => event.key === "Enter" && void connect()}
              />
            </span>
          </label>
        </div>
        {blocking ? <FixSteps problem={blocking} /> : problem && <p className="sheet-problem">⚠ {problem}</p>}
        <div className="sheet-buttons">
          <span className="spacer" />
          <button type="button" className="button primary" disabled={!project || busy} onClick={() => void connect()}>
            {busy && <Spinner />} Connect
          </button>
        </div>
        <p className="muted small">The tab reads and writes with the acli signed in on this computer. Your own small changes happen at once, with Undo; anything others would get told about asks first.</p>
      </div>
    </div>
  );
}

/** acli can't answer: what's wrong, and how to put it right. */
export function Problem({ problem, onRetry }: { problem: AcliProblem; onRetry(): void }) {
  const fix = FIXES[problem.code];
  return (
    <div className="center">
      <div className="panel problem">
        <h2>{fix?.title ?? "acli couldn't reach Jira"}</h2>
        {fix ? (
          <>
            <p className="muted">Run this {fix.where}, then try again:</p>
            <pre className="command">{fix.command}</pre>
          </>
        ) : null}
        <p className="muted small">acli said: {problem.message}</p>
        <div className="sheet-buttons">
          <span className="spacer" />
          {fix && (
            <button type="button" className="button" onClick={() => copy(fix.command)}>
              Copy
            </button>
          )}
          <button type="button" className="button primary" onClick={onRetry}>
            Try again
          </button>
        </div>
        {problem.code === "not-installed" && <p className="muted small">On Linux and Windows, see Atlassian's acli install guide.</p>}
      </div>
    </div>
  );
}
