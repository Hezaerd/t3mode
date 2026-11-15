// T3 Mode's shortcut: bound in T3 Code's keybindings.json (see @t3mode/shared/Shortcut), so it is
// listed and rebindable in Settings → Keybindings. T3 Code ignores the command; this listener
// resolves each key press against T3 Code's live bindings and opens the Plugins page on a match.
import { SHORTCUT_COMMAND } from "@t3mode/shared/Shortcut";
import { T3_HOOKS, hookSelector } from "@t3mode/shared/T3Hooks";

import {
  focusContext,
  isMacPlatform,
  matchesShortcut,
  readKeybindings,
  resolveCommand,
} from "../lib/keybindings.ts";
import type { Runtime } from "../Runtime.ts";
import type { SettingsPage } from "./settingsPage.ts";
import { ensureStyles } from "./styles.ts";

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph"]);

/** Used only while T3 Code's bindings can't be read: Ctrl+Alt+M (Cmd+Alt+M on macOS). */
const FALLBACK = {
  key: "m",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: true,
  modKey: true,
} as const;

export const installShortcut = (runtime: Runtime, page: SettingsPage): void => {
  // Includes the "T3 Mode" badge on the shortcut's row in Settings → Keybindings.
  ensureStyles();
  const isMac = isMacPlatform();
  let warned = false;

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.repeat || MODIFIER_KEYS.has(event.key)) return;
      // Bindings without Ctrl, Cmd or Alt are rare; skip the lookup for plain typing.
      if (!(event.ctrlKey || event.metaKey || event.altKey || /^F\d+$/.test(event.key))) return;
      // T3 Code's key recorder in Settings → Keybindings.
      if (event.target instanceof Element && event.target.closest(hookSelector(T3_HOOKS.capture))) {
        return;
      }
      const rules = readKeybindings();
      if (!rules && !warned) {
        warned = true;
        runtime.log("warn", "T3 Code's keybindings were not found; using Ctrl+Alt+M");
      }
      const hit = rules
        ? resolveCommand(event, rules, focusContext(event), isMac) === SHORTCUT_COMMAND
        : matchesShortcut(event, FALLBACK, isMac);
      if (!hit) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      page.open({ kind: "plugins" });
    },
    true,
  );

  // Adds the binding to keybindings.json the first time T3 Mode runs.
  void runtime.shortcut("seed").then((status) => {
    if (status === "added") runtime.log("info", "Shortcut added to T3 Code's keybindings");
  });
};
