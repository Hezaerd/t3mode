// The contract between the preload and the main process.
import type { Settings } from "./Settings.ts";
import type { ShortcutAction, ShortcutStatus } from "./Shortcut.ts";

export const Channel = {
  /** Preload → main: the source of renderer.js, re-read from disk on every call. */
  rendererSource: "t3mode:renderer-source",
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
} as const;

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
}
