// Page entry, run by the preload in T3 Code's main window after the plugins' own scripts: reads
// settings and the installed plugins, starts them, adds the settings entry and hotkey, then tells
// the main process this launch is healthy.
import type { NativeBridge } from "@t3mode/shared/Ipc";

import { Runtime } from "./Runtime.ts";
import { SettingsPage } from "./ui/settingsPage.ts";
import { installShortcut } from "./ui/shortcut.ts";
import { toast } from "./ui/toast.ts";

declare global {
  interface Window {
    readonly t3modeNative?: NativeBridge;
    __t3modeRuntime?: Runtime;
  }
}

const describe = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

const main = async (): Promise<void> => {
  const native = window.t3modeNative;
  if (!native || window.__t3modeRuntime) return;
  try {
    const [info, settings, installed, pluginData] = await Promise.all([
      native.info(),
      native.readSettings(),
      native.plugins.list(),
      native.readPluginData(),
    ]);
    const runtime = new Runtime(native, installed, settings, info, pluginData);
    window.__t3modeRuntime = runtime;
    runtime.startAll();
    runtime.watchUpdates();
    const page = new SettingsPage(runtime);

    installShortcut(runtime, page);
    let frame = 0;
    const sync = () => {
      frame = 0;
      try {
        page.sync();
      } catch (error) {
        runtime.log("warn", `Settings page failed: ${describe(error)}`);
      }
    };
    new MutationObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(sync);
    }).observe(document.body, { childList: true, subtree: true });
    sync();

    await native.ready();
    await native.log(
      "info",
      `Runtime started on T3 Code ${info.t3codeVersion} with ${installed.length} plugin${installed.length === 1 ? "" : "s"}`,
    );
  } catch (error) {
    await native.log("error", `Runtime failed to start: ${describe(error)}`).catch(() => undefined);
    toast("T3 Mode failed to start. See its log in the logs folder.", "error");
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void main(), { once: true });
} else {
  void main();
}
