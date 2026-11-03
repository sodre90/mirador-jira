import { useEffect, useRef, useState, type ReactNode } from "react";
import { shellText, writePlan } from "../jira/acli.ts";
import type { Detail, Issue, Person, TabAction, WriteAction, WriteReply } from "../jira/model.ts";
import { failureText, keyWithSummary, send, useTab, type Sheet } from "./bridge.ts";
import { Avatar, Spinner } from "./icons.tsx";
import { MarkdownText } from "./markdown.tsx";

/** What the user wrote and hasn't sent, by box, while the tab's frame lives. */
const drafts = new Map<string, string>();

export function useDraft(key: string, initial = "") {
  const [text, setText] = useState(() => drafts.get(key) ?? initial);
  useEffect(() => void (text && text !== initial ? drafts.set(key, text) : drafts.delete(key)), [key, text]);
  return [text, setText, () => drafts.delete(key)] as const;
}

export function useCommand(action: WriteAction | null) {
  const tab = useTab();
  return action ? shellText(writePlan(action, tab.state.me?.accountId ?? null)) : null;
}

/** A sheet over the tab with a title, its fields, the acli command it will run, and its buttons; Escape cancels. */
function SheetFrame({ title, children, command, footer }: { title: string; children?: ReactNode; command: string | null; footer: ReactNode }) {
  const tab = useTab();
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") tab.showSheet(null);
    };
    addEventListener("keydown", escape);
    return () => removeEventListener("keydown", escape);
  }, []);
  return (
    <div className="sheet-backdrop" onPointerDown={(event) => event.target === event.currentTarget && tab.showSheet(null)}>
      <div className="sheet" role="dialog" aria-modal aria-label={title}>
        <h2>{title}</h2>
        {children}
        {command && (
          <pre className="command" data-hint="What it runs, with your acli">
            {command}
          </pre>
        )}
        <div className="sheet-buttons">{footer}</div>
      </div>
    </div>
  );
}

/** Runs a write once the user confirms; the sheet stays, with Jira's words, when Jira refuses it. */
function useWrite(done: string) {
  const tab = useTab();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (action: TabAction, after?: (reply: WriteReply) => void) => {
    setBusy(true);
    setProblem(null);
    try {
      const reply = (await send(action)) as WriteReply;
      tab.showSheet(null);
      tab.toast(done, { undo: reply.undo });
      after?.(reply);
    } catch (error) {
      setProblem(failureText(error));
    } finally {
      setBusy(false);
    }
  };
  return { busy, problem, run };
}

function Buttons({ busy, problem, confirm, disabled, onConfirm }: { busy: boolean; problem: string | null; confirm: string; disabled?: boolean; onConfirm(): void }) {
  const tab = useTab();
  return (
    <>
      {problem && <p className="sheet-problem">⚠ {problem}</p>}
      <span className="spacer" />
      <button type="button" className="button" onClick={() => tab.showSheet(null)}>
        Cancel
      </button>
      <button type="button" className="button primary" disabled={busy || disabled} onClick={onConfirm}>
        {busy ? <Spinner /> : null} {confirm}
      </button>
    </>
  );
}

/** A Markdown box with Write and Preview; ⌘↵ confirms. Jira gets it as its rich text. */
export function WriteBox({ value, onChange, label, placeholder, onSubmit, rows = 7, autoFocus = true, id }: { value: string; onChange(text: string): void; label: string; placeholder: string; onSubmit?(): void; rows?: number; autoFocus?: boolean; id?: string }) {
  const [preview, setPreview] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => void (autoFocus && box.current?.focus()), []);
  return (
    <div className="write-box">
      <div className="write-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!preview} className={!preview ? "on" : ""} onClick={() => setPreview(false)}>
          Write
        </button>
        <button type="button" role="tab" aria-selected={preview} className={preview ? "on" : ""} onClick={() => setPreview(true)}>
          Preview
        </button>
      </div>
      {preview ? (
        <div className="preview">{value.trim() ? <MarkdownText text={value} /> : <p className="muted">Nothing to preview.</p>}</div>
      ) : (
        <textarea
          ref={box}
          id={id}
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => (event.metaKey || event.ctrlKey) && event.key === "Enter" && onSubmit?.()}
          rows={rows}
        />
      )}
    </div>
  );
}

function SummarySheet({ issue }: { issue: Issue }) {
  const [summary, setSummary] = useState(issue.summary);
  const write = useWrite(`Renamed ${issue.key}`);
  const action: WriteAction = { kind: "summary", key: issue.key, summary: summary.trim() };
  const changed = summary.trim() && summary.trim() !== issue.summary;
  const command = useCommand(changed ? action : null);
  return (
    <SheetFrame title={`Rename ${issue.key}`} command={command} footer={<Buttons {...write} confirm="Rename in Jira" disabled={!changed} onConfirm={() => write.run(action)} />}>
      <input className="wide-input title-input" aria-label="Summary" value={summary} onChange={(event) => setSummary(event.target.value)} autoFocus onKeyDown={(event) => event.key === "Enter" && changed && write.run(action)} />
    </SheetFrame>
  );
}

function DescriptionSheet({ issue, markdown: original }: { issue: Detail; markdown: string }) {
  const [markdown, setMarkdown, forget] = useDraft(`description:${issue.key}`, original);
  const write = useWrite(`Saved the description of ${keyWithSummary(issue)}`);
  const action: WriteAction = { kind: "description", key: issue.key, markdown };
  const command = useCommand(markdown !== original ? action : null);
  return (
    <SheetFrame title={`Description of ${issue.key}`} command={command} footer={<Buttons {...write} confirm="Save in Jira" disabled={markdown === original} onConfirm={() => write.run(action, forget)} />}>
      <p className="sheet-about">{issue.summary}</p>
      <WriteBox value={markdown} onChange={setMarkdown} label="Description" placeholder="The description, in Markdown" onSubmit={() => markdown !== original && write.run(action, forget)} rows={12} />
    </SheetFrame>
  );
}

function AssignSheet({ issue, to }: { issue: Issue; to: Person | null }) {
  const write = useWrite(to ? `Assigned ${issue.key} to ${to.name}` : `Unassigned ${issue.key}`);
  const action: WriteAction = { kind: "assign", key: issue.key, to };
  const command = useCommand(action);
  return (
    <SheetFrame title={to ? `Assign ${issue.key} to ${to.name}?` : `Unassign ${issue.key}?`} command={command} footer={<Buttons {...write} confirm={to ? "Assign in Jira" : "Unassign in Jira"} onConfirm={() => write.run(action)} />}>
      <p className="sheet-about">{issue.summary}</p>
      <p className="picked-person">
        <Avatar person={issue.assignee} /> {issue.assignee?.name ?? "Nobody"} → <Avatar person={to} /> {to?.name ?? "Nobody"}
      </p>
      <p className="muted small">Jira tells them, and the issue's watchers.</p>
    </SheetFrame>
  );
}

function CreateSheet({ parent }: { parent: Issue | null }) {
  const tab = useTab();
  const types = tab.state.issueTypes.filter(({ subtask }) => !subtask);
  const [type, setType] = useState(types.find(({ name }) => name === "Task")?.name ?? types[0]?.name ?? "Task");
  const [summary, setSummary] = useState("");
  const [markdown, setMarkdown, forget] = useDraft("create");
  const [labels, setLabels] = useState("");
  const [assignToMe, setAssignToMe] = useState(true);
  const write = useWrite("Created it");
  const action: WriteAction = {
    kind: "create",
    project: tab.connection.project,
    type,
    summary: summary.trim(),
    markdown,
    labels: labels
      .split(/[\s,]+/)
      .map((label) => label.trim())
      .filter(Boolean),
    parent: parent?.key ?? null,
    assignToMe,
  };
  const command = useCommand(summary.trim() ? action : null);
  const create = () =>
    summary.trim() &&
    write.run(action, (reply) => {
      forget();
      if (reply.key) tab.select(reply.key);
      tab.toast(`Created ${reply.key ?? "it"} (${summary.trim()})`);
    });
  return (
    <SheetFrame title={parent ? `New issue under ${parent.key}` : `New issue in ${tab.connection.project}`} command={command} footer={<Buttons {...write} confirm="Create in Jira" disabled={!summary.trim()} onConfirm={create} />}>
      {parent && <p className="sheet-about">{parent.summary}</p>}
      <input className="wide-input title-input" aria-label="Summary" placeholder="Summary" value={summary} onChange={(event) => setSummary(event.target.value)} autoFocus onKeyDown={(event) => event.key === "Enter" && create()} />
      <div className="field-row">
        <label>
          Type
          <select value={type} onChange={(event) => setType(event.target.value)}>
            {(types.length ? types : [{ name: "Task" }]).map(({ name }) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="grow">
          Labels
          <input className="wide-input" aria-label="Labels" placeholder="Separated by commas (optional)" value={labels} onChange={(event) => setLabels(event.target.value)} />
        </label>
      </div>
      <WriteBox value={markdown} onChange={setMarkdown} label="Description" placeholder="Description, in Markdown (optional)" onSubmit={create} rows={5} autoFocus={false} />
      <label className="check">
        <input type="checkbox" checked={assignToMe} onChange={(event) => setAssignToMe(event.target.checked)} /> Assign it to me
      </label>
    </SheetFrame>
  );
}

function SaveViewSheet({ jql }: { jql: string }) {
  const tab = useTab();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    try {
      await send({ kind: "save-view", name, jql });
      tab.showSheet(null);
      tab.setView(`saved:${name.trim()}`);
      tab.toast(`Saved the view ${name.trim()}`);
    } catch (error) {
      setProblem(failureText(error));
    }
  };
  return (
    <SheetFrame title="Save as a view" command={null} footer={<Buttons busy={false} problem={problem} confirm="Save view" disabled={!name.trim()} onConfirm={() => void save()} />}>
      <input className="wide-input" aria-label="Name" placeholder="Name, like Sync bugs" value={name} onChange={(event) => setName(event.target.value)} autoFocus onKeyDown={(event) => event.key === "Enter" && name.trim() && void save()} />
      <pre className="jql">{jql}</pre>
    </SheetFrame>
  );
}

function DisconnectSheet() {
  const tab = useTab();
  return (
    <SheetFrame
      title={`Disconnect from ${tab.connection.project}?`}
      command={null}
      footer={
        <Buttons
          busy={false}
          problem={null}
          confirm="Disconnect"
          onConfirm={() => {
            tab.showSheet(null);
            void send({ kind: "disconnect" });
          }}
        />
      }
    >
      <p className="muted">The tab forgets the project and its saved views here. Nothing changes in Jira.</p>
    </SheetFrame>
  );
}

export function SheetView({ sheet }: { sheet: Sheet }) {
  switch (sheet.kind) {
    case "summary":
      return <SummarySheet issue={sheet.issue} />;
    case "description":
      return <DescriptionSheet issue={sheet.issue} markdown={sheet.markdown} />;
    case "assign":
      return <AssignSheet issue={sheet.issue} to={sheet.to} />;
    case "create":
      return <CreateSheet parent={sheet.parent} />;
    case "save-view":
      return <SaveViewSheet jql={sheet.jql} />;
    case "disconnect":
      return <DisconnectSheet />;
  }
}
