import type { Issue } from "../jira/model.ts";
import { useTab } from "./bridge.ts";
import { Avatar, Labels, PriorityMark, Spinner, StatusLozenge, TypeBadge } from "./icons.tsx";

function Row({ issue }: { issue: Issue }) {
  const tab = useTab();
  const selected = tab.selected?.key === issue.key;
  return (
    <li>
      <button type="button" className={["row", selected && "selected", issue.status.category === "done" && "done"].filter(Boolean).join(" ")} data-key={issue.key} aria-current={selected} onClick={() => tab.select(issue.key)}>
        <TypeBadge type={issue.type} />
        <span className="row-main">
          <span className="row-title">{issue.summary}</span>
          <span className="row-meta">
            <span className="key">{issue.key}</span>
            <StatusLozenge status={issue.status} />
            <Labels labels={issue.labels} />
          </span>
        </span>
        <PriorityMark priority={issue.priority} />
        <Avatar person={issue.assignee} />
      </button>
    </li>
  );
}

export function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <ul className="list" aria-label="Issues">
      {issues.map((issue) => (
        <Row key={issue.key} issue={issue} />
      ))}
    </ul>
  );
}

/** The list a view's JQL finds, with what to say while it loads, when it's empty and when Jira refused the query. */
export function ListView() {
  const tab = useTab();
  const list = tab.state.lists[tab.jql];
  if (!list) {
    return (
      <div className="empty">
        <Spinner /> Asking Jira…
      </div>
    );
  }
  return (
    <>
      {list.problem && (
        <p className="problem-line">
          ⚠ {list.problem.code === "bad-query" ? "Jira can't read this JQL: " : ""}
          {list.problem.message}
        </p>
      )}
      {list.issues.length === 0 && !list.problem ? (
        <div className="empty">
          <p>{tab.typed ? "Nothing matches." : "Nothing here."}</p>
          <p className="muted">{tab.typed ? "Try other words, or JQL such as labels = sync." : "Issues show here once Jira has them."}</p>
        </div>
      ) : (
        <IssueList issues={list.issues} />
      )}
      {list.issues.length >= 100 && <p className="muted small pad">Showing the first 100. Narrow the search to see the rest.</p>}
    </>
  );
}
