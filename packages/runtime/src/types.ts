// What a plugin is, and what it can do through its API.
import type { LogLevel } from "@t3mode/shared/Ipc";

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
  /** JSON in localStorage, namespaced to the plugin. Lives as long as T3 Code's own UI state. */
  readonly storage: {
    readonly get: <T>(key: string, fallback: T) => T;
    readonly set: (key: string, value: unknown) => void;
  };
  readonly log: (level: LogLevel, message: string) => void;
  readonly report: (report: PluginReport) => void;
}

export interface Plugin<O extends OptionsSpec = OptionsSpec> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabledByDefault: boolean;
  readonly options: O;
  /** Called on start and again after any option change (the plugin is restarted). */
  readonly start: (api: PluginApi<O>) => void;
}

/** Keeps the option types of each plugin while storing plugins in one list. */
export const definePlugin = <const O extends OptionsSpec>(plugin: Plugin<O>): Plugin =>
  plugin as unknown as Plugin;
