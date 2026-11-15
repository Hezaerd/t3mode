// The contract between the preload and the main process.
import type { GithubSource, InstalledPlugin, PluginPreview, PluginResult } from "./Plugins.ts";
import type { Settings } from "./Settings.ts";
import type { ShortcutAction, ShortcutStatus } from "./Shortcut.ts";
import type { UpdateAction, UpdateStatus } from "./Updates.ts";

export const Channel = {
  /**
   * Preload → main: the scripts to run in the page, in order. Each loadable plugin, wrapped so
   * it only registers itself, then renderer.js. Re-read from disk on every call.
   */
  pageScripts: "t3mode:page-scripts",
  /** Preload → main: one plugin's wrapped script, or null, after an install or update. */
  pluginScript: "t3mode:plugin-script",
  /** Page → main: a PluginAction. */
  plugins: "t3mode:plugins",
  /** Page → main: one log line for the t3mode log file. */
  log: "t3mode:log",
  /** Page → main: the runtime started, so this boot counts as healthy. */
  ready: "t3mode:ready",
  /** Page → main: versions and paths, for the settings page and `status`. */
  info: "t3mode:info",
  /** Page → main: settings.json, or defaults when missing or invalid. */
  readSettings: "t3mode:read-settings",
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
} as const;

export const RENDERER_SCRIPT_NAME = "t3mode-renderer.js";

/** The Plugins page's requests. Main decodes each one, and accepts only GitHub sources. */
export type PluginAction =
  | { readonly _tag: "list" }
  | { readonly _tag: "preview"; readonly input: string }
  | { readonly _tag: "install"; readonly source: GithubSource; readonly id: string }
  | { readonly _tag: "update"; readonly id: string }
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

/** What the preload exposes on `window.t3modeNative`. */
export interface NativeBridge {
  readonly log: (level: LogLevel, message: string) => Promise<void>;
  readonly ready: () => Promise<void>;
  readonly info: () => Promise<Info>;
  readonly readSettings: () => Promise<Settings>;
  readonly writeSettings: (settings: Settings) => Promise<void>;
  readonly openLogs: () => Promise<void>;
  readonly shortcut: (action: ShortcutAction) => Promise<ShortcutStatus>;
  readonly update: (action: UpdateAction) => Promise<UpdateStatus>;
  /** Calls `listener` with each new update status. */
  readonly onUpdate: (listener: (status: UpdateStatus) => void) => void;
  readonly plugins: {
    /** Every installed plugin, with `update` filled in after a check. */
    readonly list: () => Promise<ReadonlyArray<InstalledPlugin>>;
    readonly preview: (input: string) => Promise<PluginResult<PluginPreview>>;
    readonly install: (source: GithubSource, id: string) => Promise<PluginResult<InstalledPlugin>>;
    readonly update: (id: string) => Promise<PluginResult<InstalledPlugin>>;
    /** False when it wasn't installed. */
    readonly remove: (id: string) => Promise<PluginResult<boolean>>;
    /** The list after the check. An error names the plugins whose check failed. */
    readonly checkUpdates: () => Promise<PluginResult<ReadonlyArray<InstalledPlugin>>>;
  };
  /** Runs a plugin's current code in the page, so it registers again. Rejects when it can't. */
  readonly loadPlugin: (id: string) => Promise<void>;
}
