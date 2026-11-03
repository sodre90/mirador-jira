import { useState } from "react";
import type { Issue, Status } from "../jira/model.ts";
import { keyWithSummary, send, useTab } from "./bridge.ts";
import { Avatar, PriorityMark, Spinner, StatusLozenge, TypeBadge } from "./icons.tsx";
import { ListView } from "./list.tsx";
import { PickList, Popover } from "./popover.tsx";

const DRAGGED = "application/x-jira-key";
const CATEGORY_ORDER = { new: 0, indeterminate: 1, done: 2 } as const;

function Card({ issue }: { issue: Issue }) {
  const tab = useTab();
  const selected = tab.selected?.key === issue.key;
  return (
    <article
      className={["card", selected && "selected", issue.status.category === "done" && "done"].filter(Boolean).join(" ")}
      data-key={issue.key}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAGGED, issue.key);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <button type="button" className="card-open" aria-label={`${issue.summary} · ${issue.key}`} onClick={() => tab.select(issue.key)} />
      <span className="card-title">{issue.summary}</span>
      <span className="card-foot">
        <TypeBadge type={issue.type} />
        <span className="key">{issue.key}</span>
        <PriorityMark priority={issue.priority} />
        <span className="spacer" />
        <Avatar person={issue.assignee} />
      </span>
    </article>
  );
}

function Column({ status, issues }: { status: Status; issues: Issue[] }) {
  const tab = useTab();
  const [over, setOver] = useState(false);
  const moveHere = (key: string) => {
    const issue = issues.find((each) => each.key === key) ?? tab.state.lists[tab.jql]?.issues.find((each) => each.key === key);
    if (!issue || issue.status.name === status.name) return;
    void tab.edit({ kind: "transition", key, status: status.name }, `${keyWithSummary(issue)} is ${status.name}`);
  };
  const folded = issues.length === 0;
  return (
    <section
      className={["column", `c-${status.category}`, over && "over", folded && "folded"].filter(Boolean).join(" ")}
      aria-label={status.name}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAGGED)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        const key = event.dataTransfer.getData(DRAGGED);
        if (key) moveHere(key);
      }}
    >
      {folded ? (
        <h3 data-hint={`Nothing ${status.name.toLowerCase()}. Drop a card here to move it.`}>{status.name}</h3>
      ) : (
        <>
          <h3>
            <StatusLozenge status={status} /> <span className="count">{issues.length}</span>
          </h3>
          {over && <div className="drop">Move to {status.name}</div>}
          <div className="cards">
            {issues.map((issue) => (
              <Card key={issue.key} issue={issue} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

const endText = (endDate: string | null) => {
  if (!endDate) return "";
  const days = Math.ceil((Date.parse(endDate) - Date.now()) / 86_400_000);
  if (days < 0) return "ended";
  if (days === 0) return "ends today";
  return days === 1 ? "ends tomorrow" : `${days} days left`;
};

function SprintBar() {
  const tab = useTab();
  const { state } = tab;
  const prefs = state.prefs;
  const sprint = state.sprints.find(({ id }) => id === prefs.sprint) ?? null;
  const finding = state.loading.includes("sprints");
  const open = state.sprints.filter(({ state: sprintState }) => sprintState !== "closed");
  const setPrefs = (next: Partial<typeof prefs>) => void send({ kind: "prefs", prefs: { ...prefs, ...next } });
  return (
    <div className="sprint-bar">
      <Popover className="chip" label={<>{sprint ? sprint.name : "Every open sprint"} ▾</>} hint="Pick the sprint">
        {(close) => (
          <PickList
            multiple={false}
            options={[{ value: "all", text: "Every open sprint" }, ...open.map(({ id, name, state: sprintState }) => ({ value: String(id), text: `${name}${sprintState === "future" ? " (next)" : ""}` }))]}
            chosen={[prefs.sprint === null ? "all" : String(prefs.sprint)]}
            onChange={([value]) => {
              close();
              setPrefs({ sprint: !value || value === "all" ? null : Number(value) });
            }}
          />
        )}
      </Popover>
      {finding && <Spinner />}
      {sprint && <span className="muted">{endText(sprint.endDate)}</span>}
      <span className="spacer" />
      <div className="segmented" role="group" aria-label="Layout">
        <button type="button" aria-pressed={prefs.layout === "board"} className={prefs.layout === "board" ? "on" : ""} onClick={() => setPrefs({ layout: "board" })}>
          Board
        </button>
        <button type="button" aria-pressed={prefs.layout === "list"} className={prefs.layout === "list" ? "on" : ""} onClick={() => setPrefs({ layout: "list" })}>
          List
        </button>
      </div>
    </div>
  );
}

/** The sprint as columns of its statuses, in Jira's order of categories, a status with no cards folded to a strip; dropping a card moves it there. */
export function SprintView() {
  const tab = useTab();
  const list = tab.state.lists[tab.jql];
  const board = tab.state.prefs.layout === "board";
  const seen = new Map<string, Status>([...(tab.state.statuses[tab.connection.project] ?? []), ...(list?.issues ?? []).map(({ status }) => status)].map((status) => [status.name, status]));
  const statuses = [...seen.values()].sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]);
  const columns = statuses.map((status) => ({ status, issues: (list?.issues ?? []).filter((issue) => issue.status.name === status.name) }));
  return (
    <div className="sprint">
      <SprintBar />
      {!board || !list || list.problem || list.issues.length === 0 || tab.typed ? (
        <ListView />
      ) : (
        <div className="board" style={{ gridTemplateColumns: columns.map(({ issues }) => (issues.length ? "minmax(165px, 1fr)" : "34px")).join(" ") }}>
          {columns.map(({ status, issues }) => (
            <Column key={status.name} status={status} issues={issues} />
          ))}
        </div>
      )}
    </div>
  );
}
