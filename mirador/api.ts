/**
 * Mirador's canvas plugin API, version 7, as this plugin uses it: a workspace tab and its view. Mirador doesn't publish
 * these types yet, so this is a copy of its shared/canvas-plugins.ts and of the `window.mirador` bridge in its
 * shared/canvas-document.ts.
 */

export interface CanvasPluginStorage {
  get(key: string): unknown;
  /** Undefined takes the key out. */
  set(key: string, value: unknown): void;
}

export interface PluginWorkspace {
  id: string;
  name: string;
  /** The workspace's folder, absolute, on the computer Mirador runs on. */
  folder: string;
}

export interface WorkspaceTabContext {
  workspace: PluginWorkspace;
  /** What the plugin keeps for this workspace alone, across restarts; values are JSON. */
  storage: CanvasPluginStorage;
  /** What the plugin keeps across workspaces. */
  sharedStorage: CanvasPluginStorage;
  /** Mirador asks `state` again soon after, and hands it to the tab wherever the workspace is open. */
  changed(): void;
}

export interface WorkspaceTab<State = unknown> {
  shows?(context: WorkspaceTabContext): boolean | Promise<boolean>;
  state(context: WorkspaceTabContext): State | Promise<State>;
  action?(action: unknown, context: WorkspaceTabContext): unknown;
}

export interface CanvasHost {
  items: Record<string, never>;
  tools: Record<string, never>;
  workspaceTab?: WorkspaceTab;
}

/** `window.mirador` in the view's frame, in a workspace tab. */
export interface PluginViewBridge<State = unknown> {
  place: "canvas" | "window" | "tab";
  onState(listener: (state: State) => void): () => void;
  send(action: unknown): Promise<unknown>;
  /** To the agent of the conversation whose canvas shows the tab. */
  prompt(text: string): Promise<void>;
  /** A conversation in the workspace, on its default profile, working on `text` at once, which then shows. */
  startConversation(text: string): Promise<void>;
  /** Adds `text` to what the user is writing in the conversation's composer. */
  addToComposer(text: string): Promise<void>;
  openLink(url: string): void;
}
