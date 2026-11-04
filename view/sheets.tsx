import { useEffect, useRef, useState, type ReactNode } from "react";
import { shellText, writePlan } from "../jira/acli.ts";
import { componentFilter, projectOf, sourceJql } from "../jira/jql.ts";
import type { Detail, Issue, Person, ProjectLookup, TabAction, WriteAction, WriteReply } from "../jira/model.ts";
import { PROMPT_KINDS, PROMPTS, inheritedTemplate, templateSource, type PromptKind, type PromptScope } from "../jira/prompts.ts";
import { failureText, keyWithSummary, send, useTab, type Message, type Sheet } from "./bridge.ts";
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
function SheetFrame({ title, children, command, jql, footer }: { title: string; children?: ReactNode; command: string | null; jql?: string | null; footer: ReactNode }) {
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
        {jql && (
          <pre className="jql" data-hint="What the source's view searches">
            {jql}
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

/** The project a new issue goes in at first: its parent's, the source the view shows, or the workspace's own. */
function firstProject(tab: ReturnType<typeof useTab>, parent: Issue | null) {
  if (parent) return projectOf(parent.key);
  return tab.connection.sources.find(({ name }) => tab.view === `source:${name}`)?.project ?? tab.connection.project;
}

const firstType = (types: { name: string }[]) => types.find(({ name }) => name === "Task")?.name ?? types[0]?.name ?? "Task";

function CreateSheet({ parent }: { parent: Issue | null }) {
  const tab = useTab();
  const projects = [tab.connection.project, ...new Set(tab.connection.sources.map(({ project }) => project))].filter((project, index, all) => all.indexOf(project) === index);
  const [project, setProject] = useState(() => firstProject(tab, parent));
  const typesIn = (key: string) => (tab.state.issueTypes[key] ?? []).filter(({ subtask }) => !subtask);
  const types = typesIn(project);
  const [type, setType] = useState(firstType(types));
  const [summary, setSummary] = useState("");
  const [markdown, setMarkdown, forget] = useDraft("create");
  const [labels, setLabels] = useState("");
  const [assignToMe, setAssignToMe] = useState(true);
  const write = useWrite("Created it");
  const action: WriteAction = {
    kind: "create",
    project,
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
    <SheetFrame title={parent ? `New issue under ${parent.key}` : `New issue in ${project}`} command={command} footer={<Buttons {...write} confirm="Create in Jira" disabled={!summary.trim()} onConfirm={create} />}>
      {parent && <p className="sheet-about">{parent.summary}</p>}
      <input className="wide-input title-input" aria-label="Summary" placeholder="Summary" value={summary} onChange={(event) => setSummary(event.target.value)} autoFocus onKeyDown={(event) => event.key === "Enter" && create()} />
      <div className="field-row">
        {!parent && projects.length > 1 && (
          <label>
            Project
            <select
              aria-label="Project"
              value={project}
              onChange={(event) => {
                setProject(event.target.value);
                setType(firstType(typesIn(event.target.value)));
              }}
            >
              {projects.map((key) => (
                <option key={key}>{key}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Type
          <select aria-label="Type" value={type} onChange={(event) => setType(event.target.value)}>
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

type FilterKind = "all" | "component" | "jql";

/** The workspace's projects, and adding another, whole or only the issues of a component or a query. */
function SourcesSheet() {
  const tab = useTab();
  const { connection } = tab;
  const [typedProject, setTypedProject] = useState("");
  const [found, setFound] = useState<ProjectLookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [kind, setKind] = useState<FilterKind>("component");
  const [component, setComponent] = useState("");
  const [jql, setJql] = useState("");
  const [name, setName] = useState("");
  const [nameTyped, setNameTyped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const filter = kind === "component" ? (component ? componentFilter(component) : "") : kind === "jql" ? jql.trim() : "";
  const ready = !!found && !!name.trim() && (kind === "all" || !!filter);
  const lookUp = async () => {
    if (!typedProject.trim() || looking) return;
    setLooking(true);
    setProblem(null);
    setFound(null);
    try {
      const reply = (await send({ kind: "look-up-project", project: typedProject })) as ProjectLookup;
      setFound(reply);
      setKind(reply.components.length ? "component" : "all");
      setComponent("");
      if (!nameTyped) setName(reply.name);
    } catch (error) {
      setProblem(failureText(error));
    } finally {
      setLooking(false);
    }
  };
  const pickComponent = (picked: string) => {
    setComponent(picked);
    if (!nameTyped && found) setName(picked ? `${found.project} · ${picked}` : found.name);
  };
  const add = async () => {
    if (!ready || !found || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const reply = (await send({ kind: "add-source", name, project: found.project, filter })) as { added: string; found: number | null };
      tab.showSheet(null);
      tab.setView(`source:${reply.added}`);
      tab.toast(reply.found === null ? `Added ${reply.added}` : `Added ${reply.added}: ${reply.found} ${reply.found === 1 ? "issue" : "issues"}`);
    } catch (error) {
      setProblem(failureText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SheetFrame
      title="Sources"
      command={null}
      jql={found ? sourceJql({ project: found.project, filter }) : null}
      footer={<Buttons busy={busy} problem={problem} confirm="Add the source" disabled={!ready} onConfirm={() => void add()} />}
    >
      <p className="muted small">Mine, Recent, Reported and Watching show the issues of every source, and each added source has a view of its own. Sprint stays with {connection.project}.</p>
      <ul className="sources">
        <li>
          <b>{connection.project}</b> <span className="muted">· {connection.projectName}, all of it</span>
        </li>
        {connection.sources.map((source) => (
          <li key={source.name}>
            <b>{source.name}</b> <span className="muted">· {source.filter ? `${source.project} where ${source.filter}` : `all of ${source.project}`}</span>
            <span className="spacer" />
            <button type="button" className="link danger" onClick={() => void send({ kind: "remove-source", name: source.name }).then(() => tab.toast(`Removed ${source.name}`))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <h3 className="sheet-heading">Add a source</h3>
      <div className="field-row">
        <label className="grow">
          Project key
          <input
            className="wide-input"
            aria-label="Project key"
            placeholder="Like SUP, the letters before the dash"
            value={typedProject}
            onChange={(event) => {
              setTypedProject(event.target.value.toUpperCase());
              setFound(null);
            }}
            onKeyDown={(event) => event.key === "Enter" && void lookUp()}
            autoFocus
          />
        </label>
        <button type="button" className="button" disabled={!typedProject.trim() || looking} onClick={() => void lookUp()}>
          {looking && <Spinner />} Look it up
        </button>
      </div>
      {found && (
        <>
          <p className="sheet-about">
            {found.project} is {found.name}.
          </p>
          <div className="choices" role="radiogroup" aria-label="Which issues">
            <label>
              <input type="radio" name="which" checked={kind === "all"} onChange={() => setKind("all")} /> All of its issues
            </label>
            {found.components.length > 0 && (
              <span className="choice-row">
                <label>
                  <input type="radio" name="which" checked={kind === "component"} onChange={() => setKind("component")} /> Only the component
                </label>
                <select aria-label="Component" value={component} onFocus={() => setKind("component")} onChange={(event) => pickComponent(event.target.value)}>
                  <option value="">Pick one…</option>
                  {found.components.map((each) => (
                    <option key={each}>{each}</option>
                  ))}
                </select>
              </span>
            )}
            <span className="choice-row">
              <label>
                <input type="radio" name="which" checked={kind === "jql"} onChange={() => setKind("jql")} /> Only issues matching JQL
              </label>
              <input className="inline-input grow" aria-label="Filter JQL" placeholder="like labels = escalated" value={jql} spellCheck={false} onFocus={() => setKind("jql")} onChange={(event) => setJql(event.target.value)} />
            </span>
          </div>
          <label>
            View name
            <input
              className="wide-input"
              aria-label="View name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameTyped(true);
              }}
              onKeyDown={(event) => event.key === "Enter" && void add()}
            />
          </label>
        </>
      )}
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

const SOURCE_WORDS = { workspace: "this workspace's own text", every: "the text for every workspace", "built-in": "the built-in text" } as const;

/** The messages the tab sends the agent, as this workspace or every workspace has them, with what each placeholder stands for. */
function PromptsSheet() {
  const tab = useTab();
  const overrides = tab.state.prompts;
  const [kind, setKind] = useState<PromptKind>("work");
  const [scope, setScope] = useState<PromptScope>("workspace");
  const own = overrides[scope][kind];
  const startText = own ?? inheritedTemplate(kind, overrides, scope);
  const [text, setText] = useState(startText);
  const box = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setText(startText), [startText]);
  const save = (next: string | null, done: string) => {
    setBusy(true);
    setProblem(null);
    send({ kind: "set-prompt", scope, prompt: kind, text: next }).then(
      () => (setBusy(false), tab.toast(done)),
      (error) => (setBusy(false), setProblem(failureText(error))),
    );
  };
  const insert = (name: string) => {
    const at = box.current?.selectionStart ?? text.length;
    const placed = `{${name}}`;
    setText(text.slice(0, at) + placed + text.slice(box.current?.selectionEnd ?? at));
    requestAnimationFrame(() => box.current?.setSelectionRange(at + placed.length, at + placed.length));
  };
  const inUse = templateSource(kind, overrides);
  const shadowed = scope === "every" && overrides.workspace[kind] !== undefined;
  const fallsBackToEvery = scope === "workspace" && overrides.every[kind] !== undefined;
  return (
    <SheetFrame
      title="Prompts for the agent"
      command={null}
      footer={
        <>
          {problem && <p className="sheet-problem">⚠ {problem}</p>}
          {own !== undefined && (
            <button type="button" className="button" disabled={busy} onClick={() => save(null, fallsBackToEvery ? "This workspace uses every workspace's text again" : "Put back the built-in text")}>
              {fallsBackToEvery ? "Use every workspace's text" : "Put back the built-in"}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="button" onClick={() => tab.showSheet(null)}>
            Close
          </button>
          <button type="button" className="button primary" disabled={busy || !text.trim() || text === startText} onClick={() => save(text, "Saved the prompt")}>
            {busy ? <Spinner /> : null} Save
          </button>
        </>
      }
    >
      <div className="prompt-picks">
        <select aria-label="Prompt" value={kind} onChange={(event) => setKind(event.target.value as PromptKind)}>
          {PROMPT_KINDS.map((each) => (
            <option key={each} value={each}>
              {PROMPTS[each].name}
            </option>
          ))}
        </select>
        <div className="segmented" role="group" aria-label="For">
          {(["workspace", "every"] as const).map((each) => (
            <button key={each} type="button" aria-pressed={scope === each} className={scope === each ? "on" : ""} onClick={() => setScope(each)}>
              {each === "workspace" ? "This workspace" : "Every workspace"}
            </button>
          ))}
        </div>
      </div>
      <p className="sheet-about">
        {PROMPTS[kind].sentBy} This workspace uses {SOURCE_WORDS[inUse]}.{shadowed && " This workspace has its own text, so a change here reaches it only once you take that out."}
      </p>
      <textarea ref={box} className="prompt-text" aria-label="Prompt text" value={text} onChange={(event) => setText(event.target.value)} rows={10} spellCheck={false} />
      <div className="placeholders" aria-label="Placeholders">
        {PROMPTS[kind].placeholders.map(({ name, means }) => (
          <button key={name} type="button" className="chip" data-hint={means} onClick={() => insert(name)}>
            {`{${name}}`}
          </button>
        ))}
      </div>
      <p className="muted small">A paragraph whose placeholders all come out empty is left out.</p>
    </SheetFrame>
  );
}

/** A message filled in, to change once before it goes; the saved prompt stays as it is. */
function EditMessageSheet({ messages }: { messages: Message[] }) {
  const tab = useTab();
  const [chosen, setChosen] = useState(0);
  const message = messages[chosen]!;
  const [text, setText] = useState(message.text);
  useEffect(() => setText(message.text), [message]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const go = (where: "new" | "here") => {
    setBusy(true);
    setProblem(null);
    const sending = where === "new" ? window.mirador.startConversation(text) : window.mirador.prompt(text);
    sending.then(
      () => (tab.showSheet(null), tab.toast(where === "new" ? "Started a conversation with your message" : "Sent to this conversation's agent")),
      (error) => (setBusy(false), setProblem(failureText(error))),
    );
  };
  return (
    <SheetFrame
      title="Edit the message first"
      command={null}
      footer={
        <>
          {problem && <p className="sheet-problem">⚠ {problem}</p>}
          <span className="spacer" />
          <button type="button" className="button" onClick={() => tab.showSheet(null)}>
            Cancel
          </button>
          {message.sends.includes("here") && (
            <button type="button" className={`button ${message.sends.includes("new") ? "" : "primary"}`} disabled={busy || !text.trim()} onClick={() => go("here")}>
              Send to this conversation
            </button>
          )}
          {message.sends.includes("new") && (
            <button type="button" className="button primary" disabled={busy || !text.trim()} onClick={() => go("new")}>
              {busy ? <Spinner /> : null} Start a conversation
            </button>
          )}
        </>
      }
    >
      {messages.length > 1 && (
        <div className="segmented" role="group" aria-label="Which message">
          {messages.map(({ label }, index) => (
            <button key={label} type="button" aria-pressed={chosen === index} className={chosen === index ? "on" : ""} onClick={() => setChosen(index)}>
              {label}
            </button>
          ))}
        </div>
      )}
      <textarea className="prompt-text" aria-label="Message" value={text} onChange={(event) => setText(event.target.value)} rows={12} autoFocus />
      <p className="muted small">Only this message changes. Prompts for the agent, in the ⋯ menu, change what every one starts from.</p>
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
    case "sources":
      return <SourcesSheet />;
    case "prompts":
      return <PromptsSheet />;
    case "edit-message":
      return <EditMessageSheet messages={sheet.messages} />;
    case "disconnect":
      return <DisconnectSheet />;
  }
}
