// T3 Mode's keyboard shortcut lives in T3 Code's own keybindings.json, so it is listed and
// rebindable in Settings → Keybindings. T3 Code only accepts its built-in commands plus project
// scripts (`script.<id>.run`), so the shortcut takes a project-script command that no project
// defines. T3 Code lists it as "Run Script: T3 Mode Plugins" and does nothing when it fires;
// T3 Mode's page script handles the key.
//
// Imported by the page bundle too: no Node imports here.

export const SHORTCUT_COMMAND = "script.t3-mode-plugins.run";

/** T3 Code's key syntax; `mod` is Ctrl on Windows and Linux, Cmd on macOS. */
export const SHORTCUT_DEFAULT_KEY = "mod+alt+m";

/**
 * - `status`: report whether keybindings.json has the shortcut.
 * - `seed`: add it once per T3 Mode home, unless that key is already taken.
 * - `restore`: add it again after it was removed, whatever the key is used for.
 */
export type ShortcutAction = "status" | "seed" | "restore";

/**
 * - `present`: keybindings.json binds the command.
 * - `added`: T3 Mode just added it.
 * - `missing`: not bound (removed by the user, or the default key is taken).
 * - `unavailable`: keybindings.json is missing or unreadable, so T3 Mode leaves it alone.
 */
export type ShortcutStatus = "present" | "added" | "missing" | "unavailable";
