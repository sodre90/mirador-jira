import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { allViews, searchJql, viewJql, viewShown } from "../jira/jql.ts";
import { DEFAULT_PREFS, type Issue, type Person, type Prefs, type TabState, type Undo, type ViewId, type WriteAction, type WriteReply } from "../jira/model.ts";
import { failureText, keyWithSummary, send, TabContext, type Sheet, type Tab } from "./bridge.ts";
import { SprintView } from "./board.tsx";
import { Connect, Problem } from "./connect.tsx";
import { Detail } from "./detail.tsx";
import { Spinner } from "./icons.tsx";
import { ListView } from "./list.tsx";
import { SheetView } from "./sheets.tsx";
import { TopBar } from "./top.tsx";
import viewStyles from "./view.css" with { type: "text" };

const READ_AGAIN_EVERY_MS = 120_000;
const NARROW_PX = 760;
const TOAST_MS = 5000;
const OPEN_AFTER_MS = 250;

function useTabState() {
  const [state, setState] = useState<TabState | null>(null);
  useEffect(() => window.mirador.onState(setState), []);
  return state;
}

function useNarrow(root: React.RefObject<HTMLElement | null>) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => setNarrow((entry?.contentRect.width ?? NARROW_PX) < NARROW_PX));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [root.current]);
  return narrow;
}

/** Jira is someone else's server: the list is read when it shows, then every two minutes while the page is visible, and counts only when the tab opens. */
function useReading(jql: string | null) {
  const counted = useRef(false);
  useEffect(() => {
    if (!jql) return;
    const read = (by: "timer" | "user") => {
      if (document.visibilityState !== "visible") return;
      const counts = !counted.current;
      counted.current = true;
      void send({ kind: "refresh", jql, counts, by }).catch(() => {});
    };
    const readShown = () => read("user");
    readShown();
    const timer = setInterval(() => read("timer"), READ_AGAIN_EVERY_MS);
    document.addEventListener("visibilitychange", readShown);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", readShown);
    };
  }, [jql]);
}

/** The issue the user picked, a moment after they stop moving through the list. */
function useOpening(key: string | null) {
  useEffect(() => {
    if (!key) return;
    const timer = setTimeout(() => void send({ kind: "open", key }).catch(() => {}), OPEN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [key]);
}

function useSprintsWhenShown(view: ViewId | null) {
  useEffect(() => {
    if (view === "sprint") void send({ kind: "find-sprints" }).catch(() => {});
  }, [view]);
}

type Toast = { text: string; failed: boolean; undo: Undo | null };

function ToastView({ toast, onUndo }: { toast: Toast | null; onUndo(undo: Undo): void }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.failed ? "failed" : ""}`} role="status">
      <span>{toast.text}</span>
      {toast.undo && (
        <button type="button" className="undo" onClick={() => onUndo(toast.undo!)}>
          Undo
        </button>
      )}
    </div>
  );
}

function useKeys(tab: Tab | null, sheetOpen: boolean) {
  useEffect(() => {
    if (!tab) return;
    const views: ViewId[] = allViews(tab.connection, tab.state.savedViews).map(({ id }) => id);
    const pressed = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (sheetOpen || event.metaKey || event.ctrlKey || event.altKey || target.closest("input, textarea, select, [role=dialog], .popover")) return;
      const rows = [...new Set([...document.querySelectorAll<HTMLElement>(".content [data-key]")].map((element) => element.dataset.key!))];
      const at = tab.selected ? rows.indexOf(tab.selected.key) : -1;
      const move = (by: number) => {
        const next = rows[Math.min(rows.length - 1, Math.max(0, at + by))];
        if (!next) return;
        tab.select(next);
        requestAnimationFrame(() => document.querySelector(`.content [data-key="${CSS.escape(next)}"]`)?.scrollIntoView({ block: "nearest" }));
      };
      const selected = tab.selected;
      const actions: Record<string, () => void> = {
        j: () => move(1),
        ArrowDown: () => move(1),
        k: () => move(-1),
        ArrowUp: () => move(-1),
        "/": () => document.getElementById("jira-search")?.focus(),
        r: tab.refresh,
        n: () => tab.showSheet({ kind: "create", parent: selected?.type.toLowerCase() === "epic" ? selected : null }),
        Escape: () => tab.select(null),
        ...Object.fromEntries(views.slice(0, 9).map((view, index) => [String(index + 1), () => tab.setView(view)])),
        ...(selected && {
          w: () => document.getElementById("work-on-this")?.click(),
          c: () => document.getElementById("comment-text")?.focus(),
          o: () => window.mirador.openLink(`${tab.connection.site}/browse/${selected.key}`),
        }),
      };
      const act = actions[event.key];
      if (!act) return;
      event.preventDefault();
      act();
    };
    addEventListener("keydown", pressed);
    return () => removeEventListener("keydown", pressed);
  }, [tab, sheetOpen]);
}

/** The issue as the freshest place the tab has it: its detail, the list on screen, or any other list. */
function issueIn(state: TabState, jql: string, key: string): Issue | null {
  const detail = state.details[key]?.detail;
  if (detail) return detail;
  const lists = [state.lists[jql], ...Object.values(state.lists)];
  return lists.flatMap((list) => list?.issues ?? []).find((issue) => issue.key === key) ?? null;
}

function App() {
  const state = useTabState();
  const root = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(root);
  const [prefsHere, setPrefsHere] = useState<Prefs | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const connection = state?.connection ?? null;
  const prefs = prefsHere ?? state?.prefs ?? DEFAULT_PREFS;
  const view = connection && state ? viewShown(prefs.view, connection, state.savedViews) : prefs.view;
  const jql = connection && state ? (prefs.search.trim() ? searchJql(prefs.search, connection) : viewJql(view, connection, prefs.sprint, state.savedViews)) : null;
  useReading(jql);
  useOpening(selectedKey);
  useSprintsWhenShown(connection ? view : null);
  const selected = state && jql && selectedKey ? issueIn(state, jql, selectedKey) : null;

  const showToast = useCallback((text: string, options: { failed?: boolean; undo?: Undo | null } = {}) => {
    clearTimeout(toastTimer.current);
    setToast({ text, failed: options.failed ?? false, undo: options.undo ?? null });
    toastTimer.current = setTimeout(() => setToast(null), options.undo ? TOAST_MS * 2 : TOAST_MS);
  }, []);

  const tab = useMemo<Tab | null>(() => {
    if (!state || !connection || !jql) return null;
    const setPrefs = (next: Prefs) => {
      setPrefsHere(next);
      void send({ kind: "prefs", prefs: next }).catch(() => {});
    };
    const me = state.me;
    return {
      state,
      connection,
      view,
      setView: (view) => setPrefs({ ...prefs, view, search: "" }),
      jql,
      typed: prefs.search,
      search: (typed) => setPrefs({ ...prefs, search: typed.trim() }),
      selected,
      select: setSelectedKey,
      showSheet: setSheet,
      async edit(action: WriteAction, done: string) {
        try {
          const reply = (await send(action)) as WriteReply;
          showToast(done, { undo: reply.undo });
          return reply;
        } catch (error) {
          showToast(failureText(error), { failed: true });
          return null;
        }
      },
      toast: showToast,
      refresh: () => void send({ kind: "refresh", jql, counts: true }).catch((error) => showToast(failureText(error), { failed: true })),
      narrow,
      isMe: (person: Person | null) => !!person && !!me && (person.accountId === me.accountId || (!!me.email && person.email?.toLowerCase() === me.email.toLowerCase())),
    };
  }, [state, connection, jql, view, prefs, selectedKey, selected, narrow]);

  useKeys(tab, sheet !== null);

  const undo = (what: Undo) => {
    const issue = state && jql ? issueIn(state, jql, what.key) : null;
    void send({ kind: "undo", undo: what }).then(
      () => showToast(`Put ${issue ? keyWithSummary(issue) : what.key} back`),
      (error) => showToast(failureText(error), { failed: true }),
    );
  };

  const blocking = state?.problem && (state.problem.code === "not-installed" || state.problem.code === "not-signed-in") ? state.problem : null;
  const besideList = !narrow;
  return (
    <div className={`app ${narrow ? "narrow" : "wide"}`} ref={root}>
      {!state && (
        <div className="center">
          <Spinner />
        </div>
      )}
      {state && !connection && <Connect state={state} />}
      {connection && jql && blocking && <Problem problem={blocking} onRetry={() => void send({ kind: "refresh", jql, counts: false, force: true }).catch(() => {})} />}
      {tab && !blocking && (
        <TabContext.Provider value={tab}>
          <TopBar />
          <main className={`body view-${view === "sprint" ? "sprint" : "list"} ${selectedKey ? "has-detail" : ""} ${besideList ? "beside" : "over"}`}>
            <div className="content">{view === "sprint" ? <SprintView /> : <ListView />}</div>
            {selectedKey && (
              <aside className="detail-pane">
                <Detail key={selectedKey} issueKey={selectedKey} />
              </aside>
            )}
          </main>
          {sheet && <SheetView sheet={sheet} />}
        </TabContext.Provider>
      )}
      <ToastView toast={toast} onUndo={undo} />
    </div>
  );
}

const style = document.createElement("style");
style.textContent = viewStyles;
document.head.append(style);
document.body.innerHTML = '<div id="root"></div>';
createRoot(document.getElementById("root")!).render(<App />);
