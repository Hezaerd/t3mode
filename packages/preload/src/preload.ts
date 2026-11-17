// Sandboxed preload, registered on every session. Outside T3 Code's main window it does nothing.
// In the main window it exposes `window.t3modeNative` and runs the page scripts (each installed
// plugin, then renderer.js) in the page's own world, where plugins can reach the DOM that React
// manages.
import { contextBridge, ipcRenderer, webFrame } from "electron";

import type { BackendAction, BackendEvent } from "@t3mode/shared/Backends";
import {
  Channel,
  type Info,
  type LogLevel,
  type NativeBridge,
  type PluginAction,
  isMainWindowUrl,
} from "@t3mode/shared/Ipc";
import type { Access, GithubSource, PageScript, PluginDataSnapshot } from "@t3mode/shared/Plugins";
import type { Settings } from "@t3mode/shared/Settings";
import type { ShortcutAction, ShortcutStatus } from "@t3mode/shared/Shortcut";
import type { UpdateAction, UpdateStatus } from "@t3mode/shared/Updates";
import { T3MODE_VERSION } from "@t3mode/shared/Version";

const GUARD = "__t3modePreloaded";

const describe = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

const runScript = async (script: PageScript): Promise<void> => {
  await webFrame.executeJavaScript(`${script.code}\n//# sourceURL=${script.name}`);
};

const plugins = (action: PluginAction) => ipcRenderer.invoke(Channel.plugins, action);

// The preload runs before page scripts, while the splash is still on screen.
const showSplashVersion = (): void => {
  const shell = document.getElementById("boot-shell");
  if (!shell) return;
  const label = document.createElement("div");
  label.textContent = `T3 Mode v${T3MODE_VERSION}`;
  Object.assign(label.style, {
    position: "absolute",
    bottom: "24px",
    left: "0",
    right: "0",
    textAlign: "center",
    fontSize: "11px",
    opacity: "0.5",
    pointerEvents: "none",
    userSelect: "none",
    letterSpacing: "0.02em",
  });
  shell.append(label);
};

const start = (): void => {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope[GUARD] === true || window.top !== window || !isMainWindowUrl(location.href)) return;
  scope[GUARD] = true;

  const bridge: NativeBridge = {
    log: (level: LogLevel, message: string) => ipcRenderer.invoke(Channel.log, level, message),
    ready: () => ipcRenderer.invoke(Channel.ready),
    info: () => ipcRenderer.invoke(Channel.info) as Promise<Info>,
    readSettings: () => ipcRenderer.invoke(Channel.readSettings) as Promise<Settings>,
    writeSettings: (settings: Settings) => ipcRenderer.invoke(Channel.writeSettings, settings),
    readPluginData: () => ipcRenderer.invoke(Channel.readPluginData) as Promise<PluginDataSnapshot>,
    writePluginData: (id, data) => ipcRenderer.invoke(Channel.writePluginData, id, data),
    openLogs: () => ipcRenderer.invoke(Channel.openLogs),
    shortcut: (action: ShortcutAction) =>
      ipcRenderer.invoke(Channel.shortcut, action) as Promise<ShortcutStatus>,
    update: (action: UpdateAction) =>
      ipcRenderer.invoke(Channel.update, action) as Promise<UpdateStatus>,
    onUpdate: (listener: (status: UpdateStatus) => void) => {
      ipcRenderer.on(Channel.updateChanged, (_event, status: UpdateStatus) => listener(status));
    },
    plugins: {
      list: () => plugins({ _tag: "list" }),
      preview: (input: string) => plugins({ _tag: "preview", input }),
      install: (source: GithubSource, id: string, approved: Access) =>
        plugins({ _tag: "install", source, id, approved }),
      update: (id: string, approved?: Access) =>
        plugins({ _tag: "update", id, ...(approved === undefined ? {} : { approved }) }),
      remove: (id: string) => plugins({ _tag: "remove", id }),
      checkUpdates: () => plugins({ _tag: "check" }),
    },
    loadPlugin: async (id: string) => {
      const script = (await ipcRenderer.invoke(Channel.pluginScript, id)) as PageScript | null;
      if (!script) throw new Error(`Plugin ${id} has no code that can be loaded.`);
      await runScript(script);
    },
    disks: () => ipcRenderer.invoke(Channel.disks),
    backend: (action: BackendAction) =>
      ipcRenderer.invoke(Channel.backend, action) as Promise<boolean>,
    onBackendEvent: (listener) => {
      ipcRenderer.on(Channel.backendEvent, (_event, event: BackendEvent) => listener(event));
    },
  };
  contextBridge.exposeInMainWorld("t3modeNative", bridge);
  const logError = (message: string) => bridge.log("error", message).catch(() => undefined);

  if (document.readyState === "loading") {
    document.addEventListener("readystatechange", showSplashVersion, { once: true });
  } else {
    showSplashVersion();
  }

  const runEachInOrder = (scripts: ReadonlyArray<PageScript>) =>
    scripts.reduce<Promise<unknown>>(
      (previous, script) =>
        previous.then(() =>
          runScript(script).catch((error: unknown) =>
            logError(`${script.name} failed: ${describe(error)}`),
          ),
        ),
      Promise.resolve(),
    );
  void ipcRenderer
    .invoke(Channel.pageScripts)
    .then(runEachInOrder, (error: unknown) =>
      logError(`Could not read the page scripts: ${describe(error)}`),
    );
};

start();
