// Starts and stops plugins. Everything a plugin creates goes through its API and is undone,
// newest first, when it stops. A plugin that throws is stopped and reported; the others keep running.
import type { OptionsSpec, PluginApi, PluginDefinition, PluginReport } from "@t3mode/plugin-sdk";
import type { Info, NativeBridge } from "@t3mode/shared/Ipc";
import type {
  InstalledPlugin,
  GithubSource,
  PluginDataSnapshot,
  PluginPreview,
  PluginRegistration,
  PluginResult,
  RemoveResult,
} from "@t3mode/shared/Plugins";
import type { PluginSettings, Settings } from "@t3mode/shared/Settings";
import type { ShortcutAction, ShortcutStatus } from "@t3mode/shared/Shortcut";
import type { UpdateAction, UpdateStatus } from "@t3mode/shared/Updates";

import { localSockets } from "./LocalSockets.ts";
import { pluginStorage } from "./PluginStorage.ts";
import { queryFirst } from "./dom.ts";
import { findHookState, findPropsUp } from "./lib/react.ts";
import { currentThreadKey } from "./lib/thread.ts";
import { button, group, row } from "./ui/native.ts";
import { toast } from "./ui/toast.ts";

export type PluginState =
  | { readonly kind: "off" }
  | { readonly kind: "running"; readonly report: PluginReport | null }
  | { readonly kind: "failed"; readonly error: string }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface SettingsPanel {
  readonly title: string;
  readonly render: (host: HTMLElement) => void;
}

type Entry =
  | {
      readonly info: InstalledPlugin;
      readonly kind: "loaded";
      readonly definition: PluginDefinition;
    }
  | { readonly info: InstalledPlugin; readonly kind: "broken"; readonly reason: string }
  // Registered but never run: a plugin that is off runs none of its code, not even its top level.
  | { readonly info: InstalledPlugin; readonly kind: "unloaded"; readonly load: () => unknown };

export interface PluginRegistry {
  readonly push: (...registrations: ReadonlyArray<PluginRegistration>) => number;
}

declare global {
  interface Window {
    __t3modePlugins?: PluginRegistry | Array<PluginRegistration>;
  }
}

const describe = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

const firstLine = (text: string) => text.split("\n")[0] ?? text;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isDefinition = (value: unknown): value is PluginDefinition =>
  isObject(value) && typeof value["start"] === "function" && isObject(value["options"]);

export const pluginDefinition = (exported: unknown): PluginDefinition | undefined => {
  const candidate = isObject(exported) && !isDefinition(exported) ? exported["default"] : exported;
  return isDefinition(candidate) ? candidate : undefined;
};

export const optionValues = (
  spec: OptionsSpec,
  stored: PluginSettings["options"],
): Record<string, unknown> => {
  const values: Record<string, unknown> = {};
  for (const [key, option] of Object.entries(spec)) {
    const value = stored?.[key];
    const valid =
      option.type === "boolean"
        ? typeof value === "boolean"
        : option.choices.some((choice) => choice.value === value);
    values[key] = valid ? value : option.default;
  }
  return values;
};

export class Runtime {
  readonly #native: NativeBridge;
  readonly #connect: ReturnType<typeof localSockets>;
  readonly #data = new Map<string, Record<string, unknown>>();
  readonly #storage: ReturnType<typeof pluginStorage>;
  readonly #entries = new Map<string, Entry>();
  readonly #registrations = new Map<string, () => unknown>();
  readonly #cleanups = new Map<string, Array<() => void>>();
  readonly #states = new Map<string, PluginState>();
  readonly #listeners = new Set<() => void>();
  readonly #updateListeners = new Set<(status: UpdateStatus) => void>();
  readonly #panels = new Map<string, SettingsPanel>();
  #settings: Settings;
  #update: UpdateStatus | undefined;
  readonly info: Info;

  constructor(
    native: NativeBridge,
    installed: ReadonlyArray<InstalledPlugin>,
    settings: Settings,
    info: Info,
    pluginData: PluginDataSnapshot,
  ) {
    this.#native = native;
    this.#connect = localSockets(native);
    for (const [id, data] of Object.entries(pluginData.data)) this.#data.set(id, { ...data });
    const separator = info.home.includes("\\") ? "\\" : "/";
    this.#storage = pluginStorage(
      this.#data,
      pluginData.unreadable,
      (id) => [info.home, "plugin-data", `${id}.json`].join(separator),
      native.writePluginData,
      (message) => this.log("warn", message),
    );
    this.#settings = settings;
    this.info = info;
    const pending: unknown = window.__t3modePlugins;
    if (Array.isArray(pending)) for (const item of pending) this.#register(item);
    window.__t3modePlugins = {
      push: (...registrations) => {
        for (const item of registrations) this.#register(item);
        return registrations.length;
      },
    };
    for (const plugin of installed) this.#entries.set(plugin.id, this.#entryFor(plugin));
  }

  get plugins(): ReadonlyArray<InstalledPlugin> {
    return [...this.#entries.values()]
      .map((entry) => entry.info)
      .toSorted((a, b) => a.name.localeCompare(b.name));
  }

  plugin(id: string): InstalledPlugin | undefined {
    return this.#entries.get(id)?.info;
  }

  optionSpec(id: string): OptionsSpec {
    const entry = this.#entries.get(id);
    return entry?.kind === "loaded" ? entry.definition.options : {};
  }

  /** False until the plugin is first turned on, because its options are in its code. */
  optionsKnown(id: string): boolean {
    return this.#entries.get(id)?.kind === "loaded";
  }

  state(id: string): PluginState {
    const entry = this.#entries.get(id);
    if (entry?.kind === "broken") return { kind: "unavailable", reason: entry.reason };
    return this.#states.get(id) ?? { kind: "off" };
  }

  /** The section a running plugin added to its settings page. */
  panel(id: string): SettingsPanel | undefined {
    return this.#panels.get(id);
  }

  isEnabled(id: string): boolean {
    return this.#settings.plugins[id]?.enabled ?? true;
  }

  options(id: string): Record<string, unknown> {
    return optionValues(this.optionSpec(id), this.#settings.plugins[id]?.options);
  }

  /** Called whenever a plugin's state or settings change, for the settings page. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  startAll(): void {
    for (const entry of this.#entries.values()) {
      if (!this.isEnabled(entry.info.id)) continue;
      if (entry.kind === "broken") {
        this.log("error", `Plugin ${entry.info.id} can't start: ${entry.reason}`);
        toast(
          `${entry.info.name} can't start. Open T3 Mode's plugins in Settings to see why.`,
          "error",
        );
      } else {
        this.#start(entry.info.id);
      }
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    this.#stop(id);
    if (enabled) this.#start(id);
    await this.#save(id, { enabled });
  }

  async setOption(id: string, key: string, value: unknown): Promise<void> {
    const options = { ...this.#settings.plugins[id]?.options, [key]: value };
    if (this.isEnabled(id)) {
      this.#stop(id);
      this.#start(id, options);
    }
    await this.#save(id, { options });
  }

  async retry(id: string): Promise<void> {
    const entry = this.#entries.get(id);
    if (!entry) return;
    this.#stop(id);
    this.#states.delete(id);
    if (entry.kind === "broken") await this.#rereadFromDisk(entry.info);
    if (this.isEnabled(id)) this.#start(id);
    this.#emit();
  }

  async #rereadFromDisk(previous: InstalledPlugin): Promise<void> {
    const listed = await this.#native.plugins.list().catch(() => undefined);
    const info = listed?.find((plugin) => plugin.id === previous.id) ?? previous;
    if (info.error === undefined) {
      this.#registrations.delete(info.id);
      await this.#native.loadPlugin(info.id).catch((error: unknown) => {
        this.log("error", `Plugin ${info.id} could not be loaded: ${describe(error)}`);
      });
    }
    this.#entries.set(info.id, this.#entryFor(info));
  }

  preview(input: string): Promise<PluginResult<PluginPreview>> {
    return this.#ask("Preview", () => this.#native.plugins.preview(input));
  }

  async install(source: GithubSource, id: string): Promise<PluginResult<InstalledPlugin>> {
    const result = await this.#ask("Install", () => this.#native.plugins.install(source, id));
    return this.#loadAndStart(result);
  }

  async updatePlugin(id: string, approved = false): Promise<PluginResult<InstalledPlugin>> {
    const result = await this.#ask("Update", () => this.#native.plugins.update(id, approved));
    return this.#loadAndStart(result);
  }

  async remove(id: string): Promise<PluginResult<RemoveResult>> {
    const running = this.state(id).kind === "running";
    this.#stop(id);
    await this.#storage.flush(id);
    const result = await this.#ask("Remove", () => this.#native.plugins.remove(id));
    if (result.ok) {
      this.#data.delete(id);
      this.#storage.forget(id);
      this.#entries.delete(id);
      this.#registrations.delete(id);
      this.#states.delete(id);
      this.#emit();
    } else if (running) {
      this.#start(id);
    }
    return result;
  }

  async checkUpdates(): Promise<PluginResult<ReadonlyArray<InstalledPlugin>>> {
    const result = await this.#ask("Check", () => this.#native.plugins.checkUpdates());
    const listed = result.ok
      ? result.value
      : await this.#native.plugins.list().catch(() => this.plugins);
    for (const info of listed) {
      const entry = this.#entries.get(info.id);
      if (entry) this.#entries.set(info.id, { ...entry, info });
    }
    this.#emit();
    return result;
  }

  /** T3 Mode's shortcut in T3 Code's keybindings.json; "unavailable" when that fails. */
  async shortcut(action: ShortcutAction): Promise<ShortcutStatus> {
    try {
      return await this.#native.shortcut(action);
    } catch (error) {
      this.log("warn", `Shortcut ${action} failed: ${describe(error)}`);
      return "unavailable";
    }
  }

  /** The last T3 Code update status from main, once `watchUpdates` has run. */
  get updateStatus(): UpdateStatus | undefined {
    return this.#update;
  }

  /** Follows T3 Code updates: main pushes every change once the page asked for the status. */
  watchUpdates(): void {
    this.#native.onUpdate((status) => this.#setUpdate(status));
    void this.update("status");
  }

  async update(action: UpdateAction): Promise<UpdateStatus | undefined> {
    try {
      const status = await this.#native.update(action);
      this.#setUpdate(status);
      return status;
    } catch (error) {
      this.log("warn", `Update ${action} failed: ${describe(error)}`);
      return undefined;
    }
  }

  onUpdate(listener: (status: UpdateStatus) => void): () => void {
    this.#updateListeners.add(listener);
    return () => this.#updateListeners.delete(listener);
  }

  /** Whether T3 Mode installs T3 Code's updates. Applies at the next launch. */
  async setManageUpdates(manage: boolean): Promise<void> {
    await this.#write({ ...this.#settings, updates: { ...this.#settings.updates, manage } });
    await this.update("status");
  }

  async openLogs(): Promise<void> {
    try {
      await this.#native.openLogs();
    } catch (error) {
      this.log("warn", `Could not open the logs folder: ${describe(error)}`);
      toast(`Could not open ${this.info.logs}.`, "error");
    }
  }

  log(level: "debug" | "info" | "warn" | "error", message: string): void {
    void this.#native.log(level, message).catch(() => undefined);
  }

  #register(item: unknown): void {
    if (isObject(item) && typeof item["id"] === "string" && typeof item["load"] === "function") {
      this.#registrations.set(item["id"], item["load"] as () => unknown);
    } else {
      this.log("warn", "Ignored a plugin registration that has no id or load function");
    }
  }

  #entryFor(info: InstalledPlugin): Entry {
    if (info.error !== undefined) return { info, kind: "broken", reason: info.error };
    const load = this.#registrations.get(info.id);
    if (!load) {
      return { info, kind: "broken", reason: "Its code didn't run. See T3 Mode's log." };
    }
    return this.isEnabled(info.id) ? this.#run(info, load) : { info, kind: "unloaded", load };
  }

  #run(info: InstalledPlugin, load: () => unknown): Entry {
    try {
      const definition = pluginDefinition(load());
      return definition
        ? { info, kind: "loaded", definition }
        : { info, kind: "broken", reason: "plugin.js doesn't export definePlugin(...)." };
    } catch (error) {
      this.log("error", `Plugin ${info.id} failed to load: ${describe(error)}`);
      return { info, kind: "broken", reason: `Its code threw: ${firstLine(describe(error))}` };
    }
  }

  async #loadAndStart(
    result: PluginResult<InstalledPlugin>,
  ): Promise<PluginResult<InstalledPlugin>> {
    if (!result.ok) return result;
    const info = result.value;
    this.#stop(info.id);
    this.#states.delete(info.id);
    this.#registrations.delete(info.id);
    if (info.error === undefined) {
      try {
        await this.#native.loadPlugin(info.id);
      } catch (error) {
        this.log("error", `Plugin ${info.id} could not be loaded: ${describe(error)}`);
      }
    }
    this.#entries.set(info.id, this.#entryFor(info));
    if (this.isEnabled(info.id)) this.#start(info.id);
    this.#emit();
    return result;
  }

  async #ask<A>(action: string, call: () => Promise<PluginResult<A>>): Promise<PluginResult<A>> {
    try {
      return await call();
    } catch (error) {
      this.log("error", `${action} failed: ${describe(error)}`);
      return { ok: false, error: `${action} failed. See T3 Mode's log.` };
    }
  }

  #emit(): void {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch (error) {
        this.log("error", `Settings page listener failed: ${describe(error)}`);
      }
    }
  }

  #setState(id: string, state: PluginState): void {
    this.#states.set(id, state);
    this.#emit();
  }

  #setUpdate(status: UpdateStatus): void {
    const previous = this.#update;
    this.#update = status;
    const { phase } = status;
    const newlyReady =
      phase.kind === "ready" &&
      previous !== undefined &&
      !(previous.phase.kind === "ready" && previous.phase.version === phase.version);
    if (newlyReady && status.installable) {
      toast(`T3 Code ${phase.version} is ready. It installs when you quit T3 Code.`, "info");
    }
    for (const listener of this.#updateListeners) {
      try {
        listener(status);
      } catch (error) {
        this.log("error", `Update listener failed: ${describe(error)}`);
      }
    }
  }

  async #save(id: string, patch: PluginSettings): Promise<void> {
    const current = this.#settings.plugins[id] ?? {};
    await this.#write({
      ...this.#settings,
      plugins: { ...this.#settings.plugins, [id]: { ...current, ...patch } },
    });
  }

  async #write(next: Settings): Promise<void> {
    this.#settings = next;
    this.#emit();
    try {
      await this.#native.writeSettings(this.#settings);
    } catch (error) {
      this.log("error", `Could not save settings: ${describe(error)}`);
      toast("T3 Mode could not save its settings. See its log.", "error");
    }
  }

  #fail(id: string, error: unknown): void {
    if (this.state(id).kind !== "running") return;
    this.#stop(id);
    const detail = describe(error);
    this.#setState(id, { kind: "failed", error: firstLine(detail) });
    this.log("error", `Plugin ${id} failed and was stopped: ${detail}`);
    toast(
      `${this.plugin(id)?.name ?? id} stopped after an error. Open T3 Mode's plugins in Settings to retry.`,
      "error",
    );
  }

  #stop(id: string): void {
    const cleanups = this.#cleanups.get(id) ?? [];
    this.#cleanups.delete(id);
    for (const cleanup of cleanups.toReversed()) {
      try {
        cleanup();
      } catch (error) {
        this.log("warn", `Cleanup of ${id} failed: ${describe(error)}`);
      }
    }
    if (this.#states.get(id)?.kind === "running") this.#setState(id, { kind: "off" });
  }

  #start(id: string, storedOptions?: PluginSettings["options"]): void {
    let entry = this.#entries.get(id);
    if (entry?.kind === "unloaded") {
      entry = this.#run(entry.info, entry.load);
      this.#entries.set(id, entry);
      this.#emit();
    }
    if (entry?.kind !== "loaded") return;
    const { definition } = entry;
    const cleanups: Array<() => void> = [];
    this.#cleanups.set(id, cleanups);
    this.#setState(id, { kind: "running", report: null });
    const alive = () => this.#cleanups.get(id) === cleanups;

    /** Wraps every callback a plugin hands to the API, so its errors stop only that plugin. */
    const guard =
      <A extends ReadonlyArray<unknown>>(callback: (...args: A) => void) =>
      (...args: A): void => {
        if (!alive()) return;
        try {
          callback(...args);
        } catch (error) {
          this.#fail(id, error);
        }
      };
    const add = (cleanup: () => void) => cleanups.push(cleanup);

    const api: PluginApi = {
      id,
      sockets: { connect: (name) => this.#connect(id, name, alive, guard, add) },
      options: optionValues(
        definition.options,
        storedOptions ?? this.#settings.plugins[id]?.options,
      ) as PluginApi["options"],
      css: (text) => {
        const style = document.createElement("style");
        style.dataset["t3modePlugin"] = id;
        style.textContent = text;
        document.head.append(style);
        add(() => style.remove());
      },
      observe: (callback) => {
        const run = guard(callback);
        let frame = 0;
        const schedule = () => {
          if (frame === 0) {
            frame = requestAnimationFrame(() => {
              frame = 0;
              run();
            });
          }
        };
        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        window.addEventListener("hashchange", schedule);
        add(() => {
          observer.disconnect();
          window.removeEventListener("hashchange", schedule);
          cancelAnimationFrame(frame);
        });
        run();
      },
      listen: (target, type, handler, options) => {
        const wrapped = guard(handler as (event: Event) => void);
        target.addEventListener(type, wrapped, options);
        add(() => target.removeEventListener(type, wrapped, options));
      },
      interval: (callback, ms) => {
        const handle = window.setInterval(guard(callback), ms);
        add(() => window.clearInterval(handle));
      },
      element: (tag) => {
        const element = document.createElement(tag);
        element.dataset["t3modePlugin"] = id;
        add(() => element.remove());
        return element;
      },
      onCleanup: add,
      storage: this.#storage.storage(id),
      settingsPanel: (title, render) => {
        this.#panels.set(id, { title, render: guard(render) });
        add(() => this.#panels.delete(id));
        this.#emit();
      },
      toast: (message, kind) => {
        if (alive()) toast(message, kind);
      },
      ui: {
        group,
        row,
        button: (options) => button({ ...options, onClick: guard(options.onClick) }),
      },
      log: (level, message) => this.log(level, `[${id}] ${message}`),
      report: (report) => {
        const state = this.state(id);
        if (!alive() || state.kind !== "running") return;
        if (state.report?.state === report.state && state.report.detail === report.detail) return;
        this.#setState(id, { kind: "running", report });
      },
      queryFirst,
      currentThreadKey,
      react: { findPropsUp, findHookState },
      disks: () => this.#native.disks(),
    };

    try {
      definition.start(api);
    } catch (error) {
      this.#fail(id, error);
    }
  }
}
