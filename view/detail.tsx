import { useEffect, useState } from "react";
import { adfToMarkdown, editableAsMarkdown } from "../jira/adf.ts";
import { childrenJql } from "../jira/jql.ts";
import { issueUrl, mentionText, planText, workText } from "../jira/handoff.ts";
import type { Comment, Detail as DetailData, Issue, Link, Related, WriteAction } from "../jira/model.ts";
import { failureText, keyWithSummary, send, useTab } from "./bridge.ts";
import { AdfView } from "./adf.tsx";
import { ago, agoText } from "./format.ts";
import { Avatar, KeyChip, PriorityMark, Spinner, StatusLozenge, TypeBadge } from "./icons.tsx";
import { PickList, Popover } from "./popover.tsx";
import { useCommand, useDraft, WriteBox } from "./sheets.tsx";

type Section = "details" | "links" | "activity";

function useHandOff() {
  const tab = useTab();
  return (act: () => Promise<void>, done: string) => void act().then(() => tab.toast(done), (error) => tab.toast(failureText(error), { failed: true }));
}

function WorkOnThis({ issue, detail }: { issue: Issue; detail: DetailData | null }) {
  const tab = useTab();
  const handOff = useHandOff();
  const site = tab.connection.site;
  const isEpic = issue.type.toLowerCase() === "epic";
  const children = tab.state.lists[childrenJql(issue.key)]?.issues ?? [];
  const text = () => (isEpic ? planText(issue, detail, children, site) : workText(issue, detail, site));
  const start = () => handOff(() => window.mirador.startConversation(text()), `Started a conversation on ${keyWithSummary(issue)}`);
  return (
    <span className="split-button">
      <button type="button" id="work-on-this" className="button primary" data-hint="A new conversation in this workspace works on it (w)" onClick={start}>
        {isEpic ? "Plan with the agent" : "Work on this"}
      </button>
      <Popover className="button primary split-arrow" label="▾" name="More ways to hand it to the agent" hint="More ways to hand it to the agent">
        {(close) => (
          <div className="menu wide">
            <button type="button" onClick={() => (close(), start())}>
              <b>Start a conversation</b>
              <small>A new conversation in this workspace {isEpic ? "looks at it and plans it" : "works on it, and asks before changing it in Jira"}</small>
            </button>
            <button type="button" onClick={() => (close(), handOff(() => window.mirador.prompt(text()), "Sent to this conversation's agent"))}>
              <b>Send to this conversation</b>
              <small>The agent here gets it as your next message</small>
            </button>
            <button type="button" onClick={() => (close(), handOff(() => window.mirador.addToComposer(mentionText(issue, site)), "Added to the composer"))}>
              <b>Mention in the composer</b>
              <small>Adds its key, summary and link to what you're writing</small>
            </button>
          </div>
        )}
      </Popover>
    </span>
  );
}

function Picker({ label, value, hint, children }: { label: string; value: React.ReactNode; hint?: string; children: (close: () => void) => React.ReactNode }) {
  return (
    <Popover className="picker" label={<><small>{label}</small> {value} ▾</>} hint={hint ?? `Change the ${label.toLowerCase()}`}>
      {children}
    </Popover>
  );
}

function LabelAdder({ issue }: { issue: Issue }) {
  const tab = useTab();
  const [text, setText] = useState("");
  const known = [...new Set(Object.values(tab.state.lists).flatMap(({ issues }) => issues.flatMap(({ labels }) => labels)))].filter((label) => !issue.labels.includes(label)).sort();
  const add = (label: string, close: () => void) => {
    const clean = label.trim().replace(/\s+/g, "-");
    if (!clean) return;
    close();
    void tab.edit({ kind: "labels", key: issue.key, add: [clean], remove: [] }, `Labelled ${keyWithSummary(issue)} ${clean}`);
  };
  return (
    <Popover className="picker" label="+ label" hint="Add a label">
      {(close) => (
        <div className="label-picker">
          <input className="pick-filter" autoFocus aria-label="New label" placeholder="A label, new or known" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => event.key === "Enter" && add(text, close)} />
          {known.length > 0 && <PickList multiple={false} options={known.filter((label) => label.includes(text.trim())).map((label) => ({ value: label, text: label }))} chosen={[]} onChange={([label]) => label && add(label, close)} />}
        </div>
      )}
    </Popover>
  );
}

function Fields({ issue, detail }: { issue: Issue; detail: DetailData | null }) {
  const tab = useTab();
  const { state } = tab;
  const statuses = state.statuses.some(({ name }) => name === issue.status.name) ? state.statuses : [issue.status, ...state.statuses];
  const me = state.people.find((person) => tab.isMe(person)) ?? null;
  const others = state.people.filter((person) => !tab.isMe(person) && person.accountId !== issue.assignee?.accountId);
  const sprint = detail?.sprints.find(({ state: sprintState }) => sprintState !== "closed") ?? detail?.sprints.at(-1) ?? null;
  return (
    <div className="fields">
      <KeyChip issueKey={issue.key} />
      <Picker label="Status" value={<StatusLozenge status={issue.status} />} hint="Move it to another status (at once, with Undo)">
        {(close) => (
          <PickList
            multiple={false}
            options={statuses.map(({ name }) => ({ value: name, text: name }))}
            chosen={[issue.status.name]}
            onChange={([picked]) => {
              close();
              if (picked && picked !== issue.status.name) void tab.edit({ kind: "transition", key: issue.key, status: picked }, `${keyWithSummary(issue)} is ${picked}`);
            }}
          />
        )}
      </Picker>
      <Picker label="Assignee" value={<><Avatar person={issue.assignee} size={14} /> {issue.assignee?.name ?? <span className="muted">Unassigned</span>}</>}>
        {(close) => (
          <div className="menu">
            {me && !tab.isMe(issue.assignee) && (
              <button type="button" onClick={() => (close(), void tab.edit({ kind: "assign", key: issue.key, to: me }, `Assigned ${keyWithSummary(issue)} to you`))}>
                <b>Assign to me</b> <small>at once, with Undo</small>
              </button>
            )}
            {issue.assignee && tab.isMe(issue.assignee) && (
              <button type="button" onClick={() => (close(), void tab.edit({ kind: "assign", key: issue.key, to: null }, `Unassigned ${keyWithSummary(issue)}`))}>
                <b>Unassign me</b> <small>at once, with Undo</small>
              </button>
            )}
            {issue.assignee && !tab.isMe(issue.assignee) && (
              <button type="button" onClick={() => (close(), tab.showSheet({ kind: "assign", issue, to: null }))}>
                Unassign {issue.assignee.name}…
              </button>
            )}
            {others.length > 0 && <hr />}
            {others.slice(0, 12).map((person) => (
              <button key={person.accountId} type="button" onClick={() => (close(), tab.showSheet({ kind: "assign", issue, to: person }))}>
                <Avatar person={person} size={14} /> {person.name}…
              </button>
            ))}
          </div>
        )}
      </Picker>
      {issue.labels.map((label) => (
        <span key={label} className="label removable">
          {label}
          <button type="button" aria-label={`Remove the label ${label}`} onClick={() => void tab.edit({ kind: "labels", key: issue.key, add: [], remove: [label] }, `Took ${label} off ${keyWithSummary(issue)}`)}>
            ×
          </button>
        </span>
      ))}
      <LabelAdder issue={issue} />
      <span className="field" data-hint="Change the priority in Jira">
        <small>priority</small> <PriorityMark priority={issue.priority} /> {issue.priority ?? "none"}
      </span>
      <span className="field">
        <small>type</small> <TypeBadge type={issue.type} /> {issue.type}
      </span>
      {sprint && (
        <span className="field">
          <small>sprint</small> {sprint.name}
        </span>
      )}
      {issue.reporter && (
        <span className="field">
          <small>reporter</small> <Avatar person={issue.reporter} size={14} /> {issue.reporter.name}
        </span>
      )}
    </div>
  );
}

function Actions({ issue, detail }: { issue: Issue; detail: DetailData | null }) {
  const tab = useTab();
  const url = issueUrl(tab.connection.site, issue.key);
  return (
    <div className="actions">
      <WorkOnThis issue={issue} detail={detail} />
      <button type="button" className="button" data-hint="Open it in Jira (o)" onClick={() => window.mirador.openLink(url)}>
        Open in Jira
      </button>
      <Popover className="button icon-like" label="⋯" name="More actions" hint="More" align="right">
        {(close) => (
          <div className="menu">
            <button type="button" onClick={() => (close(), tab.showSheet({ kind: "summary", issue }))}>
              Rename…
            </button>
            <button type="button" onClick={() => (close(), tab.showSheet({ kind: "create", parent: issue }))}>
              New issue under it…
            </button>
            <button type="button" onClick={() => (close(), void navigator.clipboard?.writeText(url).then(() => tab.toast("Copied the link")))}>
              Copy the link
            </button>
          </div>
        )}
      </Popover>
    </div>
  );
}

function Description({ detail }: { detail: DetailData }) {
  const tab = useTab();
  const editable = editableAsMarkdown(detail.description);
  return (
    <section className="text-section">
      <header>
        <h3>Description</h3>
        {editable ? (
          <button type="button" className="link" onClick={() => tab.showSheet({ kind: "description", issue: detail, markdown: adfToMarkdown(detail.description) })}>
            {detail.description?.content?.length ? "Edit" : "Write"}
          </button>
        ) : (
          <button type="button" className="link" data-hint="It has mentions, tables or attachments, which only Jira's editor keeps" onClick={() => window.mirador.openLink(issueUrl(tab.connection.site, detail.key))}>
            Edit in Jira
          </button>
        )}
      </header>
      <AdfView doc={detail.description} empty="No description." />
    </section>
  );
}

function RelatedRow({ related, relation }: { related: Related; relation?: string }) {
  const tab = useTab();
  return (
    <li>
      <button type="button" className="related" onClick={() => tab.select(related.key)}>
        {relation && <span className="relation">{relation}</span>}
        {related.type && <TypeBadge type={related.type} />}
        <span className="related-title">{related.summary}</span>
        <span className="key">{related.key}</span>
        {related.status && <StatusLozenge status={related.status} />}
      </button>
    </li>
  );
}

function Links({ issue, detail }: { issue: Issue; detail: DetailData }) {
  const tab = useTab();
  const children = tab.state.lists[childrenJql(issue.key)];
  const byRelation = detail.links.reduce<Record<string, Link[]>>((groups, link) => ({ ...groups, [link.relation]: [...(groups[link.relation] ?? []), link] }), {});
  const nothing = !detail.parent && detail.subtasks.length === 0 && detail.links.length === 0 && !children?.issues.length;
  return (
    <div className="links">
      {detail.parent && (
        <div className="link-group">
          <h4>Parent</h4>
          <ul>
            <RelatedRow related={detail.parent} />
          </ul>
        </div>
      )}
      {children && children.issues.length > 0 && (
        <div className="link-group">
          <h4>
            Under it <span className="count">{children.issues.length}</span>
          </h4>
          <ul>
            {children.issues.map((child) => (
              <RelatedRow key={child.key} related={{ key: child.key, summary: child.summary, status: child.status, type: child.type }} />
            ))}
          </ul>
        </div>
      )}
      {detail.subtasks.length > 0 && (
        <div className="link-group">
          <h4>Sub-tasks</h4>
          <ul>
            {detail.subtasks.map((subtask) => (
              <RelatedRow key={subtask.key} related={subtask} />
            ))}
          </ul>
        </div>
      )}
      {Object.entries(byRelation).map(([relation, links]) => (
        <div key={relation} className="link-group">
          <h4>{relation[0]!.toUpperCase() + relation.slice(1)}</h4>
          <ul>
            {links.map((link) => (
              <RelatedRow key={link.key} related={link} />
            ))}
          </ul>
        </div>
      ))}
      {nothing && <p className="muted">No parent, sub-tasks or links.</p>}
    </div>
  );
}

function CommentView({ comment }: { comment: Comment }) {
  return (
    <article className="comment">
      <Avatar person={comment.author} size={24} />
      <div className="comment-body">
        <header>
          <b>{comment.author?.name ?? "Someone"}</b> commented · {agoText(comment.created)}
          {comment.updated !== comment.created && <span className="muted"> · edited</span>}
        </header>
        <AdfView doc={comment.body} empty="(empty)" />
      </div>
    </article>
  );
}

function CommentBox({ issue }: { issue: Issue }) {
  const tab = useTab();
  const [markdown, setMarkdown, forget] = useDraft(`comment:${issue.key}`);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const action: WriteAction = { kind: "comment", key: issue.key, markdown };
  const command = useCommand(markdown.trim() ? action : null);
  const post = async () => {
    if (!markdown.trim() || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await send(action);
      forget();
      setMarkdown("");
      tab.toast(`Commented on ${keyWithSummary(issue)}`);
    } catch (error) {
      setProblem(failureText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="comment-box">
      <WriteBox id="comment-text" value={markdown} onChange={setMarkdown} label="Comment" placeholder="Write a comment, in Markdown (⌘↵ posts). Jira tells the watchers." onSubmit={() => void post()} rows={3} autoFocus={false} />
      {problem && <p className="sheet-problem">⚠ {problem}</p>}
      <div className="comment-buttons">
        <code className="muted small">{command ?? `acli jira workitem comment create --key ${issue.key} …`}</code>
        <span className="spacer" />
        <button type="button" className="button primary" disabled={busy || !markdown.trim()} onClick={() => void post()}>
          {busy && <Spinner />} Comment in Jira
        </button>
      </div>
    </div>
  );
}

function Activity({ issue, detail }: { issue: Issue; detail: DetailData }) {
  return (
    <div className="timeline">
      <div className="event">
        <span className="event-dot" />
        {detail.reporter ? <b>{detail.reporter.name}</b> : "Someone"} created it · {agoText(detail.created)}
      </div>
      {detail.comments.map((comment) => (
        <CommentView key={comment.id} comment={comment} />
      ))}
      {detail.updated && detail.updated !== detail.created && (
        <div className="event">
          <span className="event-dot" />
          Last changed {agoText(detail.updated)}
        </div>
      )}
      <CommentBox issue={issue} />
    </div>
  );
}

export function Detail({ issueKey }: { issueKey: string }) {
  const tab = useTab();
  const [section, setSection] = useState<Section>("details");
  const result = tab.state.details[issueKey];
  const detail = result?.detail ?? null;
  const issue: Issue | null = tab.selected ?? detail;
  const isEpic = issue?.type.toLowerCase() === "epic";
  useEffect(() => {
    if (isEpic) void send({ kind: "refresh", jql: childrenJql(issueKey), counts: false }).catch(() => {});
  }, [issueKey, isEpic]);
  if (!issue) {
    return (
      <div className="detail">
        <p className="muted">{result?.problem ? `⚠ ${result.problem.message}` : <><Spinner /> Reading {issueKey}…</>}</p>
      </div>
    );
  }
  const children = tab.state.lists[childrenJql(issue.key)]?.issues.length ?? 0;
  const linkCount = detail ? (detail.parent ? 1 : 0) + detail.subtasks.length + detail.links.length + children : 0;
  return (
    <div className="detail">
      <div className="detail-top">
        <nav className="crumbs" aria-label="Parent">
          {detail?.parent ? (
            <button type="button" className="link" onClick={() => tab.select(detail.parent!.key)}>
              {detail.parent.key} {detail.parent.summary} ›
            </button>
          ) : (
            <span>{tab.connection.projectName}</span>
          )}
        </nav>
        <button type="button" className="icon-button" aria-label="Close the issue's panel" data-hint="Close (Esc)" onClick={() => tab.select(null)}>
          ×
        </button>
      </div>
      <h1 className="detail-title" data-hint="Rename it" onClick={() => tab.showSheet({ kind: "summary", issue })}>
        {issue.summary}
      </h1>
      <Fields issue={issue} detail={detail} />
      <Actions issue={issue} detail={detail} />
      <div className="sections" role="tablist">
        <button type="button" role="tab" aria-selected={section === "details"} className={section === "details" ? "on" : ""} onClick={() => setSection("details")}>
          Details
        </button>
        <button type="button" role="tab" aria-selected={section === "links"} className={section === "links" ? "on" : ""} onClick={() => setSection("links")}>
          Links <span className="count">{linkCount}</span>
        </button>
        <button type="button" role="tab" aria-selected={section === "activity"} className={section === "activity" ? "on" : ""} onClick={() => setSection("activity")}>
          Activity <span className="count">{detail?.comments.length ?? 0}</span>
        </button>
      </div>
      {!detail && !result?.problem && (
        <p className="muted">
          <Spinner /> Reading it…
        </p>
      )}
      {result?.problem && <p className="problem-line">⚠ {result.problem.message}</p>}
      {detail && section === "details" && (
        <div className="texts">
          <Description detail={detail} />
          <p className="muted small detail-foot">
            Created {agoText(detail.created)} · changed {ago(detail.updated)}
            {detail.components.length > 0 && ` · ${detail.components.join(", ")}`}
            {detail.fixVersions.length > 0 && ` · fix in ${detail.fixVersions.join(", ")}`}
            {detail.dueDate && ` · due ${detail.dueDate}`}
            {detail.resolution && ` · ${detail.resolution}`}
          </p>
        </div>
      )}
      {detail && section === "links" && <Links issue={issue} detail={detail} />}
      {detail && section === "activity" && <Activity issue={issue} detail={detail} />}
    </div>
  );
}
