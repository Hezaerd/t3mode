// T3 Mode's shortcut in T3 Code's keybindings.json (see @t3mode/shared/Shortcut). T3 Code's
// server watches that file and reloads it live, and keeps entries it can't decode, so adding one
// entry with an atomic write is safe. T3 Mode only ever adds its own entry; it never edits or
// removes the user's.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { app } from "electron";

import { t3KeybindingsPath } from "@t3mode/shared/Layout";
import {
  SHORTCUT_COMMAND,
  SHORTCUT_DEFAULT_KEY,
  type ShortcutAction,
  type ShortcutStatus,
} from "@t3mode/shared/Shortcut";

import { Files } from "./Files.ts";
import { Home } from "./Home.ts";

const Entry = Schema.Struct({
  key: Schema.optionalKey(Schema.Unknown),
  command: Schema.optionalKey(Schema.Unknown),
  when: Schema.optionalKey(Schema.Unknown),
});
// Entries are kept as they are on write; only `key`, `command` and `when` are read.
const KeybindingsJson = Schema.fromJsonString(Schema.Array(Schema.Unknown));

export const ShortcutActionSchema = Schema.Literals(["status", "seed", "restore"]);

const MODIFIER_ALIASES: Readonly<Record<string, string>> = {
  control: "ctrl",
  cmd: "meta",
  command: "meta",
  option: "alt",
  opt: "alt",
};

/** `"Mod+Alt+M"` and `"alt+ctrl+m"` compare equal on Windows. */
export const normalizeKey = (key: string, platform: string): string => {
  const mod = platform === "darwin" ? "meta" : "ctrl";
  const parts = key
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => (part === "mod" ? mod : (MODIFIER_ALIASES[part] ?? part)));
  const last = parts.at(-1) ?? "";
  return [...parts.slice(0, -1).toSorted(), last].join("+");
};

/** True when another unconditional rule already uses the default key. */
export const defaultKeyTaken = (entries: ReadonlyArray<unknown>, platform: string): boolean => {
  const wanted = normalizeKey(SHORTCUT_DEFAULT_KEY, platform);
  return entries.some((entry) => {
    const decoded = Schema.decodeUnknownOption(Entry)(entry);
    if (Option.isNone(decoded)) return false;
    const { key, when } = decoded.value;
    return typeof key === "string" && when === undefined && normalizeKey(key, platform) === wanted;
  });
};

export const hasShortcut = (entries: ReadonlyArray<unknown>): boolean =>
  entries.some((entry) => {
    const decoded = Schema.decodeUnknownOption(Entry)(entry);
    return Option.isSome(decoded) && decoded.value.command === SHORTCUT_COMMAND;
  });

export class T3Keybindings extends Context.Service<
  T3Keybindings,
  { readonly shortcut: (action: ShortcutAction) => Effect.Effect<ShortcutStatus> }
>()("@t3mode/main/T3Keybindings") {}

export const layer = Layer.effect(
  T3Keybindings,
  Effect.gen(function* () {
    const files = yield* Files;
    const { layout } = yield* Home;
    const path = t3KeybindingsPath(process.env, app.getPath("home"));
    const platform = process.platform;

    const shortcut = Effect.fn("T3Keybindings.shortcut")(
      function* (action: ShortcutAction) {
        const text = yield* files.readText(path);
        // T3 Code writes its defaults on first start; until then there is nothing to add to.
        if (Option.isNone(text)) return "unavailable" as const;
        const entries = yield* Schema.decodeEffect(KeybindingsJson)(text.value);

        if (hasShortcut(entries)) {
          if (!(yield* files.exists(layout.shortcutSeeded))) {
            yield* files.writeTextAtomic(layout.shortcutSeeded, "");
          }
          return "present" as const;
        }
        if (action === "status") return "missing" as const;
        // Seeded once: if it's gone since, the user removed it.
        if (action === "seed" && (yield* files.exists(layout.shortcutSeeded))) {
          return "missing" as const;
        }
        if (action === "seed" && defaultKeyTaken(entries, platform)) {
          yield* Effect.logInfo(`Shortcut not added: ${SHORTCUT_DEFAULT_KEY} is already bound`);
          return "missing" as const;
        }

        const next = [...entries, { key: SHORTCUT_DEFAULT_KEY, command: SHORTCUT_COMMAND }];
        // Pretty-printed like T3 Code writes it.
        // @effect-diagnostics-next-line globalJsonInEffect:off - keeps the user's file readable
        yield* files.writeTextAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
        yield* files.writeTextAtomic(layout.shortcutSeeded, "");
        yield* Effect.logInfo(`Shortcut added to ${path}`, { action });
        return "added" as const;
      },
      Effect.catch((error) =>
        Effect.logWarning(`Could not read or update ${path}`, error).pipe(
          Effect.as("unavailable" as const),
        ),
      ),
    );

    return T3Keybindings.of({ shortcut });
  }),
);
