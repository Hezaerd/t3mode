// Plugin backends: one Electron utilityProcess per enabled plugin that declares a `backend`
// script (see "Backends" in docs/architecture.md). These are the shapes main, the preload, the page
// runtime and the backend host agree on. Main is the only router: it spawned each process for one
// plugin id, so a message from a process belongs to that plugin.

/** What the page sees of one plugin's backend. No status means no backend runs for it. */
export type BackendStatus =
  | { readonly state: "starting" }
  | { readonly state: "running" }
  /** It crashed and restarts at `retryAt` (ms since the epoch). */
  | {
      readonly state: "restarting";
      readonly crashes: number;
      readonly error: string;
      readonly retryAt: number;
    }
  /** It crashed too often and stays down until the user retries. */
  | { readonly state: "failed"; readonly crashes: number; readonly error: string };

/** Page → main. */
export type BackendAction =
  /** Start receiving every BackendEvent, beginning with the current statuses. */
  | { readonly _tag: "subscribe" }
  /** A message for the plugin's own backend. Dropped when none runs. */
  | { readonly _tag: "send"; readonly plugin: string; readonly data: unknown }
  /** Start a backend that failed, now. */
  | { readonly _tag: "retry"; readonly plugin: string };

/** Main → page. */
export type BackendEvent =
  | { readonly _tag: "message"; readonly plugin: string; readonly data: unknown }
  | { readonly _tag: "status"; readonly plugin: string; readonly status: BackendStatus | null };

/** Main → backend host, over the utility process's parentPort. */
export type ToBackendHost = { readonly _tag: "message"; readonly data: unknown };

/** Backend host → main. */
export type FromBackendHost =
  /** The plugin's `start` returned. */
  { readonly _tag: "ready" } | { readonly _tag: "message"; readonly data: unknown };

/** Environment variables main gives the backend host. */
export const BackendEnv = {
  plugin: "T3MODE_PLUGIN_ID",
  script: "T3MODE_PLUGIN_BACKEND",
  data: "T3MODE_PLUGIN_DATA",
} as const;

/** Crash policy: restart after 1 s, 2 s, 4 s…, and give up at this many crashes in the window. */
export const BACKEND_MAX_CRASHES = 3;
export const BACKEND_CRASH_WINDOW_MS = 60_000;
export const BACKEND_FIRST_RETRY_MS = 1_000;
export const BACKEND_MAX_RETRY_MS = 10_000;

/** The delay before restarting after the `crashes`-th crash in the window (1-based). */
export const backendRetryDelay = (crashes: number): number =>
  Math.min(BACKEND_FIRST_RETRY_MS * 2 ** Math.max(0, crashes - 1), BACKEND_MAX_RETRY_MS);
