import { useEffect, useState } from "react";
import { allViews, viewJql } from "../jira/jql.ts";
import type { ViewId } from "../jira/model.ts";
import { send, useTab } from "./bridge.ts";
import { updatedText } from "./format.ts";
import { Spinner } from "./icons.tsx";
import { Popover } from "./popover.tsx";

function useNow(every = 20_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

export function TopBar() {
  const tab = useTab();
  const { state, connection } = tab;
  const now = useNow();
  const [typed, setTyped] = useState(tab.typed);
  useEffect(() => setTyped(tab.typed), [tab.typed, tab.view]);
  const views: { id: ViewId; name: string; hint: string }[] = allViews(connection, state.savedViews);
  const list = state.lists[tab.jql];
  const loading = state.loading.includes(`list:${tab.jql}`);
  const savedName = tab.view.startsWith("saved:") ? tab.view.slice("saved:".length) : null;
  return (
    <header className="top-bar">
      <div className="views" role="tablist" aria-label="Views">
        {views.map(({ id, name, hint }, index) => {
          const count = state.counts[viewJql(id, connection, state.prefs.sprint, state.savedViews)];
          return (
            <button key={id} type="button" role="tab" aria-selected={tab.view === id && !tab.typed} className={tab.view === id && !tab.typed ? "on" : ""} data-hint={index < 9 ? `${hint} (${index + 1})` : hint} onClick={() => tab.setView(id)}>
              {name}
              {count !== undefined && <span className="count">{count}</span>}
            </button>
          );
        })}
      </div>
      <div className="search">
        <span className="search-icon" aria-hidden>
          ⌕
        </span>
        <input
          id="jira-search"
          aria-label="Search"
          placeholder="Words, a key or JQL"
          value={typed}
          spellCheck={false}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") tab.search(typed);
            if (event.key === "Escape" && typed) {
              event.stopPropagation();
              setTyped("");
              tab.search("");
            }
          }}
        />
        {tab.typed && (
          <button type="button" className="search-clear" aria-label="Clear the search" onClick={() => tab.search("")}>
            ×
          </button>
        )}
      </div>
      {tab.typed && (
        <button type="button" className="link" onClick={() => tab.showSheet({ kind: "save-view", jql: tab.jql })}>
          Save as a view
        </button>
      )}
      <span className={`live ${list?.problem ? "off" : ""}`} aria-live="polite">
        {loading ? <Spinner /> : <i />} {list?.problem ? "Couldn't read Jira" : updatedText(list?.fetchedAt ?? null, now)}
      </span>
      <span className="spacer" />
      <button type="button" className="button primary" data-hint="New issue (n)" onClick={() => tab.showSheet({ kind: "create", parent: null })}>
        + New
      </button>
      <Popover className="icon-button" label="⋯" name="More" hint="More" align="right">
        {(close) => (
          <div className="menu">
            <button type="button" onClick={() => (close(), tab.refresh())}>
              Read again <small>r</small>
            </button>
            <button type="button" onClick={() => (close(), tab.showSheet({ kind: "sources" }))}>
              Sources…
            </button>
            <button type="button" onClick={() => (close(), tab.showSheet({ kind: "prompts" }))}>
              Prompts for the agent…
            </button>
            <button type="button" onClick={() => (close(), window.mirador.openLink(`${connection.site}/browse/${connection.project}`))}>
              Open {connection.project} in Jira
            </button>
            {savedName && (
              <button type="button" onClick={() => (close(), void send({ kind: "remove-view", name: savedName }).then(() => tab.setView("mine")))}>
                Remove the view {savedName}
              </button>
            )}
            <hr />
            <button type="button" className="danger" onClick={() => (close(), tab.showSheet({ kind: "disconnect" }))}>
              Disconnect…
            </button>
          </div>
        )}
      </Popover>
    </header>
  );
}
