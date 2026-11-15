// Sandboxed preload, registered on every session. Outside T3 Code's main window it does nothing.
// In the main window it exposes `window.t3modeNative` and runs the page scripts (each installed
// plugin, then renderer.js) in the page's own world, where plugins can reach the DOM that React
// manages.
import { contextBridge, ipcRenderer, webFrame } from "electron";

import {
  Channel,
  type Info,
  type LogLevel,
  type NativeBridge,
  type PluginAction,
  type SocketEvent,
  isMainWindowUrl,
} from "@t3mode/shared/Ipc";
import type { GithubSource, PageScript, PluginDataSnapshot } from "@t3mode/shared/Plugins";
import type { Settings } from "@t3mode/shared/Settings";
import type { ShortcutAction, ShortcutStatus } from "@t3mode/shared/Shortcut";
import type { UpdateAction, UpdateStatus } from "@t3mode/shared/Updates";

const GUARD = "__t3modePreloaded";

const describe = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

const runScript = async (script: PageScript): Promise<void> => {
  await webFrame.executeJavaScript(`${script.code}\n//# sourceURL=${script.name}`);
};

const plugins = (action: PluginAction) => ipcRenderer.invoke(Channel.plugins, action);

const start = (): void => {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope[GUARD] === true || window.top !== window || !isMainWindowUrl(location.href)) return;
  scope[GUARD] = true;

  const bridge: NativeBridge = {
    socket: {
      connect: (plugin, name) =>
        ipcRenderer.invoke(Channel.socket, { _tag: "connect", plugin, name }),
      write: (id, data) => ipcRenderer.invoke(Channel.socket, { _tag: "write", id, data }),
      close: (id) => ipcRenderer.invoke(Channel.socket, { _tag: "close", id }),
    },
    onSocketEvent: (listener) => {
      ipcRenderer.on(Channel.socketEvent, (_event, event: SocketEvent) => listener(event));
    },
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
      install: (source: GithubSource, id: string) => plugins({ _tag: "install", source, id }),
      update: (id: string) => plugins({ _tag: "update", id }),
      remove: (id: string) => plugins({ _tag: "remove", id }),
      checkUpdates: () => plugins({ _tag: "check" }),
    },
    loadPlugin: async (id: string) => {
      const script = (await ipcRenderer.invoke(Channel.pluginScript, id)) as PageScript | null;
      if (!script) throw new Error(`Plugin ${id} has no code that can be loaded.`);
      await runScript(script);
    },
  };
  contextBridge.exposeInMainWorld("t3modeNative", bridge);
  const logError = (message: string) => bridge.log("error", message).catch(() => undefined);

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
