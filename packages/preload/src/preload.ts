// Sandboxed preload, registered on every session. Outside T3 Code's main window it does nothing.
// In the main window it exposes `window.t3modeNative` and runs renderer.js in the page's own world,
// where plugins can reach the DOM that React manages.
import { contextBridge, ipcRenderer, webFrame } from "electron";

import {
  Channel,
  type Info,
  type LogLevel,
  type NativeBridge,
  isMainWindowUrl,
} from "@t3mode/shared/Ipc";
import type { Settings } from "@t3mode/shared/Settings";
import type { ShortcutAction, ShortcutStatus } from "@t3mode/shared/Shortcut";
import type { UpdateAction, UpdateStatus } from "@t3mode/shared/Updates";

const GUARD = "__t3modePreloaded";

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
    openLogs: () => ipcRenderer.invoke(Channel.openLogs),
    shortcut: (action: ShortcutAction) =>
      ipcRenderer.invoke(Channel.shortcut, action) as Promise<ShortcutStatus>,
    update: (action: UpdateAction) =>
      ipcRenderer.invoke(Channel.update, action) as Promise<UpdateStatus>,
    onUpdate: (listener: (status: UpdateStatus) => void) => {
      ipcRenderer.on(Channel.updateChanged, (_event, status: UpdateStatus) => listener(status));
    },
  };
  contextBridge.exposeInMainWorld("t3modeNative", bridge);

  ipcRenderer
    .invoke(Channel.rendererSource)
    .then((source: string) =>
      source
        ? webFrame.executeJavaScript(`${source}\n//# sourceURL=t3mode-renderer.js`)
        : undefined,
    )
    .catch((error: unknown) =>
      bridge.log(
        "error",
        `renderer.js failed: ${error instanceof Error ? error.stack : String(error)}`,
      ),
    );
};

start();
