// The contract between t3mode and a plugin. A plugin's bundle default-exports
// `definePlugin({ options, start })`; its id, name and version live in its manifest.json. A
// plugin's backend script exports `defineBackend({ start })`.
// Changing anything here in a way that breaks plugins means a new PLUGIN_API_VERSION.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface BooleanOption {
  readonly type: "boolean";
  readonly label: string;
  readonly description?: string;
  readonly default: boolean;
}

export interface SelectOption<V extends string = string> {
  readonly type: "select";
  readonly label: string;
  readonly description?: string;
  readonly choices: ReadonlyArray<{ readonly value: V; readonly label: string }>;
  readonly default: V;
}

export type OptionSpec = BooleanOption | SelectOption;
export type OptionsSpec = Readonly<Record<string, OptionSpec>>;

export type OptionValues<O extends OptionsSpec> = {
  readonly [K in keyof O]: O[K] extends SelectOption<infer V> ? V : boolean;
};

/** Shown on the settings page next to each running plugin. */
export interface PluginReport {
  readonly state: "active" | "waiting";
  readonly detail: string;
}

export interface RowOptions {
  readonly title?: string;
  /** Text, or nodes such as a textarea, under the title. */
  readonly description?: string | Node;
  /** Shown on the right, or under the text in a narrow pane. */
  readonly control?: Node | null;
}

export interface ButtonOptions {
  readonly text: string;
  readonly variant?: "ghost" | "outline";
  readonly onClick: () => void;
}

/** T3 Code's own settings components, so a settings panel looks native. */
export interface PluginUi {
  /** A bordered group of rows, with a line between rows. */
  readonly group: (...rows: ReadonlyArray<Node>) => HTMLElement;
  readonly row: (options: RowOptions) => HTMLElement;
  readonly button: (options: ButtonOptions) => HTMLButtonElement;
}

/** A local fixed drive. */
export interface Disk {
  /** The drive's root, such as `C:\`. */
  readonly path: string;
  /** Bytes. */
  readonly total: number;
  /** Bytes available to the user. */
  readonly free: number;
}

/** A plugin's backend as its page code sees it. Null: no backend runs for it. */
export type BackendStatus =
  | { readonly state: "starting" }
  | { readonly state: "running" }
  /** It crashed, and restarts at `retryAt` (milliseconds since the epoch). */
  | {
      readonly state: "restarting";
      readonly crashes: number;
      readonly error: string;
      readonly retryAt: number;
    }
  /** It crashed too often in a short time, and stays down until the user retries. */
  | { readonly state: "failed"; readonly crashes: number; readonly error: string };

/** The page side of a plugin's backend: messages to and from its own process. */
export interface PluginBackend {
  /**
   * Sends `data` (anything structured clone can copy) to the backend. Resolves false when no
   * backend runs for the plugin, and the message is dropped.
   */
  readonly send: (data: unknown) => Promise<boolean>;
  /** Called for every message the backend sends. */
  readonly onMessage: (callback: (data: unknown) => void) => void;
  /** Called now with the current status, then on every change. */
  readonly onStatus: (callback: (status: BackendStatus | null) => void) => void;
}

export interface PluginApi<O extends OptionsSpec = OptionsSpec> {
  /** The id from the plugin's manifest.json. */
  readonly id: string;
  readonly options: OptionValues<O>;
  /** Adds a stylesheet, removed when the plugin stops. */
  readonly css: (text: string) => void;
  /** Runs `callback` now and after DOM changes and route changes, at most once per frame. */
  readonly observe: (callback: () => void) => void;
  readonly listen: <E extends Event = Event>(
    target: EventTarget,
    type: string,
    handler: (event: E) => void,
    options?: AddEventListenerOptions,
  ) => void;
  readonly interval: (callback: () => void, ms: number) => void;
  /** Creates an element owned by the plugin. It is removed when the plugin stops. */
  readonly element: <K extends keyof HTMLElementTagNameMap>(tag: K) => HTMLElementTagNameMap[K];
  readonly onCleanup: (cleanup: () => void) => void;
  /** JSON in <home>/plugin-data/<id>.json. Deleted when the plugin is removed or uninstall --purge runs. */
  readonly storage: {
    /**
     * False when the file exists but isn't a JSON object. `get` then returns each fallback and
     * `set` stores nothing, so the file is never written over. A fix takes effect on reload.
     */
    readonly readable: boolean;
    /** The file's absolute path, to show the user. */
    readonly path: string;
    readonly get: <T>(key: string, fallback: T) => T;
    readonly set: (key: string, value: unknown) => void;
  };
  /** A section on the plugin's settings page, below Options, filled by `render` on each draw. */
  readonly settingsPanel: (title: string, render: (host: HTMLElement) => void) => void;
  /** A short message in the window's corner. Dropped once the plugin has stopped. */
  readonly toast: (message: string, kind?: "info" | "error") => void;
  readonly ui: PluginUi;
  readonly log: (level: LogLevel, message: string) => void;
  readonly report: (report: PluginReport) => void;
  /** The first element matching any of the selectors, tried in order: newest markup first. */
  readonly queryFirst: <E extends Element = HTMLElement>(
    candidates: ReadonlyArray<string>,
  ) => E | null;
  /** The thread on screen as T3 Code keys it, `<environmentId>:<threadId>`, or null off a thread. */
  readonly currentThreadKey: (hash?: string) => string | null;
  /**
   * T3 Code's React state, read from the fiber React attaches to DOM nodes. Component names are
   * minified, so lookups match on the shape of the data, and return undefined when it changed.
   */
  readonly react: {
    /** Props of the closest ancestor component (inclusive) whose props pass `test`. */
    readonly findPropsUp: (
      node: Element,
      test: (props: Record<string, unknown>) => boolean,
      maxDepth?: number,
    ) => Record<string, unknown> | undefined;
    /** The first hook state in the tree under the root of `node` that passes `test`. */
    readonly findHookState: <T>(
      node: Element,
      test: (value: unknown) => value is T,
      budget?: number,
    ) => T | undefined;
  };
  /**
   * Size and free space of each local fixed drive, cached for 30 seconds. Network and removable
   * drives are left out. Added in SDK 1.3.0, so check for it before calling.
   */
  readonly disks?: () => Promise<ReadonlyArray<Disk>>;
  /**
   * The plugin's backend, the program its manifest's `backend` names. Added in SDK 1.4.0, so
   * check for it before calling.
   */
  readonly backend?: PluginBackend;
}

export interface PluginDefinition<O extends OptionsSpec = OptionsSpec> {
  readonly options: O;
  /** Called on start and again after any option change (the plugin is restarted). */
  start(api: PluginApi<O>): void;
}

/** Returns the definition unchanged, typing `api.options` from `options`. */
export const definePlugin = <const O extends OptionsSpec>(
  definition: PluginDefinition<O>,
): PluginDefinition<O> => definition;

/** What a backend's `start` gets. Added in SDK 1.4.0. */
export interface BackendApi {
  /** The id from the plugin's manifest.json. */
  readonly id: string;
  /**
   * The backend's own folder, `<home>/plugin-data/<id>/`. It exists when `start` runs, and is
   * deleted when the plugin is removed.
   */
  readonly dataDir: string;
  /** Sends `data` (anything structured clone can copy) to the plugin's page code. */
  readonly send: (data: unknown) => void;
  /** Called for every message the page code sends. Messages that came before are delivered too. */
  readonly onMessage: (callback: (data: unknown) => void) => void;
  /** A line in `<home>/logs/plugins/<id>.log`, where the backend's stdout and stderr go too. */
  readonly log: (level: LogLevel, message: string) => void;
}

export interface BackendDefinition {
  /**
   * Called once when the process starts. The backend runs until the plugin is turned off,
   * updated or removed, or T3 Code quits; a throw, a rejected promise or an exit is a crash.
   */
  start(api: BackendApi): void | Promise<void>;
}

/** Returns the definition unchanged: the default export of the plugin's backend script. */
export const defineBackend = (definition: BackendDefinition): BackendDefinition => definition;
