// The contract between the preload and the main process.
import type { BackendAction, BackendEvent } from "./Backends.ts";
import type {
  Access,
  GithubSource,
  InstalledPlugin,
  PluginData,
  PluginDataSnapshot,
  PluginPreview,
  PluginResult,
  RemoveResult,
} from "./Plugins.ts";
import type { Settings } from "./Settings.ts";
import type { ShortcutAction, ShortcutStatus } from "./Shortcut.ts";
import type { UpdateAction, UpdateStatus } from "./Updates.ts";

export type SocketAction =
  | { readonly _tag: "connect"; readonly plugin: string; readonly name: string }
  | { readonly _tag: "write"; readonly id: number; readonly data: Uint8Array }
  | { readonly _tag: "close"; readonly id: number };

export type SocketEvent =
  | { readonly _tag: "data"; readonly id: number; readonly data: Uint8Array }
  | { readonly _tag: "closed"; readonly id: number; readonly error?: string };

export const Channel = {
  /** Page → main: a SocketAction on a local socket the plugin's manifest declares. */
  socket: "t3mode:socket",
  /** Main → page: a SocketEvent for a socket this page opened. */
  socketEvent: "t3mode:socket-event",
  /** Preload → main: each loadable plugin's wrapped plugin.js, then renderer.js, re-read on every call. */
  pageScripts: "t3mode:page-scripts",
  /** Preload → main: one plugin's wrapped plugin.js, after an install or update. */
  pluginScript: "t3mode:plugin-script",
  /** Page → main: a PluginAction. Main accepts only GitHub sources from the page. */
  plugins: "t3mode:plugins",
  /** Page → main: one log line for the t3mode log file. */
  log: "t3mode:log",
  /** Page → main: the runtime started, so this boot counts as healthy. */
  ready: "t3mode:ready",
  /** Page → main: versions and paths, for the settings page and `status`. */
  info: "t3mode:info",
  /** Page → main: settings.json, or defaults when missing or invalid. */
  readSettings: "t3mode:read-settings",
  /** Page → main: every plugin's `plugin-data/<id>.json`, read once at startup. */
  readPluginData: "t3mode:read-plugin-data",
  /** Page → main: replace one plugin's `plugin-data/<id>.json`. */
  writePluginData: "t3mode:write-plugin-data",
  /** Page → main: replace settings.json. */
  writeSettings: "t3mode:write-settings",
  /** Page → main: show the logs folder in Explorer. */
  openLogs: "t3mode:open-logs",
  /** Page → main: T3 Mode's shortcut in T3 Code's keybindings.json (see Shortcut.ts). */
  shortcut: "t3mode:shortcut",
  /** Page → main: update status, a check now, or restart to install (see Updates.ts). */
  update: "t3mode:update",
  /** Main → page: the update status changed. Sent to pages that asked for the status. */
  updateChanged: "t3mode:update-changed",
  /** Page → main: size and free space of the local fixed drives. */
  disks: "t3mode:disks",
  /** Page → main: a BackendAction (see Backends.ts). */
  backend: "t3mode:backend",
  /** Main → page: a BackendEvent, sent to pages that subscribed. */
  backendEvent: "t3mode:backend-event",
} as const;

export const RENDERER_SCRIPT_NAME = "t3mode-renderer.js";

export type PluginAction =
  | { readonly _tag: "list" }
  | { readonly _tag: "preview"; readonly input: string }
  | {
      readonly _tag: "install";
      readonly source: GithubSource;
      readonly id: string;
      readonly approved: Access;
    }
  | { readonly _tag: "update"; readonly id: string; readonly approved?: Access }
  | { readonly _tag: "remove"; readonly id: string }
  | { readonly _tag: "check" };

/** T3 Code's main window. Dev builds use schemes like `t3code-dev`. */
export const MAIN_WINDOW_URL = /^t3code(?:-[a-z]+)?:\/\/app\//;

export const isMainWindowUrl = (url: string): boolean => MAIN_WINDOW_URL.test(url);

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Info {
  readonly t3modeVersion: string;
  readonly t3codeVersion: string;
  readonly home: string;
  readonly logs: string;
  readonly safeMode: boolean;
}

export interface Disk {
  /** The drive's root, such as `C:\`. */
  readonly path: string;
  /** Bytes. */
  readonly total: number;
  /** Bytes available to the user. */
  readonly free: number;
}

/** What the preload exposes on `window.t3modeNative`. */
export interface NativeBridge {
  readonly socket: {
    readonly connect: (plugin: string, name: string) => Promise<PluginResult<number>>;
    readonly write: (id: number, data: Uint8Array) => Promise<void>;
    readonly close: (id: number) => Promise<void>;
  };
  readonly onSocketEvent: (listener: (event: SocketEvent) => void) => void;
  readonly log: (level: LogLevel, message: string) => Promise<void>;
  readonly ready: () => Promise<void>;
  readonly info: () => Promise<Info>;
  readonly readSettings: () => Promise<Settings>;
  readonly readPluginData: () => Promise<PluginDataSnapshot>;
  readonly writePluginData: (id: string, data: PluginData) => Promise<void>;
  readonly writeSettings: (settings: Settings) => Promise<void>;
  readonly openLogs: () => Promise<void>;
  readonly shortcut: (action: ShortcutAction) => Promise<ShortcutStatus>;
  readonly update: (action: UpdateAction) => Promise<UpdateStatus>;
  /** Calls `listener` with each new update status. */
  readonly onUpdate: (listener: (status: UpdateStatus) => void) => void;
  readonly plugins: {
    readonly list: () => Promise<ReadonlyArray<InstalledPlugin>>;
    readonly preview: (input: string) => Promise<PluginResult<PluginPreview>>;
    readonly install: (
      source: GithubSource,
      id: string,
      approved: Access,
    ) => Promise<PluginResult<InstalledPlugin>>;
    readonly update: (id: string, approved?: Access) => Promise<PluginResult<InstalledPlugin>>;
    readonly remove: (id: string) => Promise<PluginResult<RemoveResult>>;
    readonly checkUpdates: () => Promise<PluginResult<ReadonlyArray<InstalledPlugin>>>;
  };
  readonly loadPlugin: (id: string) => Promise<void>;
  readonly disks: () => Promise<ReadonlyArray<Disk>>;
  /** Sends a BackendAction. `send` resolves to false when no backend runs for the plugin. */
  readonly backend: (action: BackendAction) => Promise<boolean>;
  /** Calls `listener` with each BackendEvent. Subscribe with a `subscribe` action. */
  readonly onBackendEvent: (listener: (event: BackendEvent) => void) => void;
}
