// Starts and stops plugins. Everything a plugin creates goes through its API and is undone,
// newest first, when it stops. A plugin that throws is stopped and reported; the others keep running.
import type { Info, NativeBridge } from "@t3mode/shared/Ipc";
import type { PluginSettings, Settings } from "@t3mode/shared/Settings";
import type { ShortcutAction, ShortcutStatus } from "@t3mode/shared/Shortcut";
import type { UpdateAction, UpdateStatus } from "@t3mode/shared/Updates";

import type { OptionsSpec, Plugin, PluginApi, PluginReport } from "./types.ts";
import { toast } from "./ui/toast.ts";

export type PluginState =
  | { readonly kind: "off" }
  | { readonly kind: "running"; readonly report: PluginReport | null }
  | { readonly kind: "failed"; readonly error: string };

const STORAGE_PREFIX = "t3mode:";

const describe = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

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
  readonly #plugins: ReadonlyArray<Plugin>;
  readonly #cleanups = new Map<string, Array<() => void>>();
  readonly #states = new Map<string, PluginState>();
  readonly #listeners = new Set<() => void>();
  readonly #updateListeners = new Set<(status: UpdateStatus) => void>();
  #settings: Settings;
  #update: UpdateStatus | undefined;
  readonly info: Info;

  constructor(
    native: NativeBridge,
    plugins: ReadonlyArray<Plugin>,
    settings: Settings,
    info: Info,
  ) {
    this.#native = native;
    this.#plugins = plugins;
    this.#settings = settings;
    this.info = info;
  }

  get plugins(): ReadonlyArray<Plugin> {
    return this.#plugins;
  }

  state(id: string): PluginState {
    return this.#states.get(id) ?? { kind: "off" };
  }

  isEnabled(plugin: Plugin): boolean {
    return this.#settings.plugins[plugin.id]?.enabled ?? plugin.enabledByDefault;
  }

  options(plugin: Plugin): Record<string, unknown> {
    return optionValues(plugin.options, this.#settings.plugins[plugin.id]?.options);
  }

  /** Called whenever a plugin's state or settings change, for the settings page. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  startAll(): void {
    for (const plugin of this.#plugins) if (this.isEnabled(plugin)) this.#start(plugin);
  }

  async setEnabled(plugin: Plugin, enabled: boolean): Promise<void> {
    this.#stop(plugin);
    if (enabled) this.#start(plugin);
    await this.#save(plugin.id, { enabled });
  }

  async setOption(plugin: Plugin, key: string, value: unknown): Promise<void> {
    const options = { ...this.#settings.plugins[plugin.id]?.options, [key]: value };
    if (this.isEnabled(plugin)) {
      this.#stop(plugin);
      this.#start(plugin, options);
    }
    await this.#save(plugin.id, { options });
  }

  /** Restarts a failed plugin. */
  retry(plugin: Plugin): void {
    this.#stop(plugin);
    this.#start(plugin);
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

  #fail(plugin: Plugin, error: unknown): void {
    if (this.state(plugin.id).kind !== "running") return;
    this.#stop(plugin);
    const detail = describe(error);
    this.#setState(plugin.id, { kind: "failed", error: detail.split("\n")[0] ?? detail });
    this.log("error", `Plugin ${plugin.id} failed and was stopped: ${detail}`);
    toast(
      `${plugin.name} stopped after an error. Open T3 Mode's plugins in Settings to retry.`,
      "error",
    );
  }

  #stop(plugin: Plugin): void {
    const cleanups = this.#cleanups.get(plugin.id) ?? [];
    this.#cleanups.delete(plugin.id);
    for (const cleanup of cleanups.toReversed()) {
      try {
        cleanup();
      } catch (error) {
        this.log("warn", `Cleanup of ${plugin.id} failed: ${describe(error)}`);
      }
    }
    if (this.state(plugin.id).kind === "running") this.#setState(plugin.id, { kind: "off" });
  }

  #start(plugin: Plugin, storedOptions?: PluginSettings["options"]): void {
    const cleanups: Array<() => void> = [];
    this.#cleanups.set(plugin.id, cleanups);
    this.#setState(plugin.id, { kind: "running", report: null });
    const alive = () => this.#cleanups.get(plugin.id) === cleanups;

    /** Wraps every callback a plugin hands to the API, so its errors stop only that plugin. */
    const guard =
      <A extends ReadonlyArray<unknown>>(callback: (...args: A) => void) =>
      (...args: A): void => {
        if (!alive()) return;
        try {
          callback(...args);
        } catch (error) {
          this.#fail(plugin, error);
        }
      };
    const add = (cleanup: () => void) => cleanups.push(cleanup);

    const api: PluginApi = {
      id: plugin.id,
      options: optionValues(
        plugin.options,
        storedOptions ?? this.#settings.plugins[plugin.id]?.options,
      ) as PluginApi["options"],
      css: (text) => {
        const style = document.createElement("style");
        style.dataset["t3modePlugin"] = plugin.id;
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
        element.dataset["t3modePlugin"] = plugin.id;
        add(() => element.remove());
        return element;
      },
      onCleanup: add,
      storage: {
        get: (key, fallback) => {
          try {
            const raw = localStorage.getItem(`${STORAGE_PREFIX}${plugin.id}:${key}`);
            return raw === null ? fallback : (JSON.parse(raw) as typeof fallback);
          } catch {
            return fallback;
          }
        },
        set: (key, value) => {
          try {
            localStorage.setItem(`${STORAGE_PREFIX}${plugin.id}:${key}`, JSON.stringify(value));
          } catch (error) {
            this.log("warn", `Plugin ${plugin.id} could not store ${key}: ${describe(error)}`);
          }
        },
      },
      log: (level, message) => this.log(level, `[${plugin.id}] ${message}`),
      report: (report) => {
        const state = this.state(plugin.id);
        if (!alive() || state.kind !== "running") return;
        if (state.report?.state === report.state && state.report.detail === report.detail) return;
        this.#setState(plugin.id, { kind: "running", report });
      },
    };

    try {
      plugin.start(api);
    } catch (error) {
      this.#fail(plugin, error);
    }
  }
}
