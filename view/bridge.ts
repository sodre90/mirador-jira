import { createContext, useContext } from "react";
import type { Connection, Detail, Issue, Person, Sort, TabAction, TabState, Undo, ViewId, WriteAction, WriteReply } from "../jira/model.ts";
import type { PluginViewBridge } from "../mirador/api.ts";

declare global {
  interface Window {
    mirador: PluginViewBridge<TabState>;
  }
}

export const send = (action: TabAction) => window.mirador.send(action);

/** A sheet over the tab: a write to confirm, or a form that ends in one. */
export type Sheet =
  | { kind: "summary"; issue: Issue }
  | { kind: "description"; issue: Detail; markdown: string }
  | { kind: "assign"; issue: Issue; to: Person | null }
  | { kind: "create"; parent: Issue | null }
  | { kind: "save-view"; jql: string }
  | { kind: "sources" }
  | { kind: "disconnect" };

/** What every part of the tab reaches: the host's state for the workspace, and the user's place in it. */
export interface Tab {
  state: TabState;
  connection: Connection;
  view: ViewId;
  setView(view: ViewId): void;
  /** The JQL the list shows: the view's own, or what the search box asked. */
  jql: string;
  /** What the search box holds; empty for the view's own query. */
  typed: string;
  search(typed: string): void;
  /** The order the list is in; null when the view can't be put in another. */
  sort: Sort | null;
  setSort(sort: Sort): void;
  selected: Issue | null;
  select(key: string | null): void;
  showSheet(sheet: Sheet | null): void;
  /** A change made at once: its toast, with Undo. */
  edit(action: WriteAction, done: string): Promise<WriteReply | null>;
  toast(text: string, options?: { failed?: boolean; undo?: Undo | null }): void;
  refresh(): void;
  narrow: boolean;
  isMe(person: Person | null): boolean;
}

export const TabContext = createContext<Tab | null>(null);

export function useTab(): Tab {
  const tab = useContext(TabContext);
  if (!tab) throw new Error("useTab outside the tab");
  return tab;
}

/** An action's failure, as its message: the host words them for the user. */
export const failureText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A key with its summary, as every key the user reads carries what it is. */
export const keyWithSummary = (issue: Pick<Issue, "key" | "summary">, most = 48) => `${issue.key} (${issue.summary.length > most ? `${issue.summary.slice(0, most - 1)}…` : issue.summary})`;
