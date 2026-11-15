// The contract between t3mode and a plugin. A plugin's bundle default-exports
// `definePlugin({ options, start })`; its id, name and version live in its manifest.json.
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
    readonly get: <T>(key: string, fallback: T) => T;
    readonly set: (key: string, value: unknown) => void;
  };
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
