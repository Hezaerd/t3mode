import { describe, expect, it } from "vite-plus/test";

import {
  evaluateWhen,
  eventKeys,
  isResolvedRules,
  type KeyEventLike,
  matchesShortcut,
  type ResolvedRule,
  resolveCommand,
} from "./lib/keybindings.ts";

const key = (init: Partial<KeyEventLike> & { key: string }): KeyEventLike => ({
  code: "",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...init,
});

const shortcut = (k: string, mods: Partial<ResolvedRule["shortcut"]> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  modKey: false,
  ...mods,
});

const ctrlAltM = key({ key: "m", code: "KeyM", ctrlKey: true, altKey: true });

describe("matchesShortcut", () => {
  it("treats mod as Ctrl off macOS and Cmd on macOS", () => {
    const modAltM = shortcut("m", { modKey: true, altKey: true });
    expect(matchesShortcut(ctrlAltM, modAltM, false)).toBe(true);
    expect(matchesShortcut(ctrlAltM, modAltM, true)).toBe(false);
    expect(matchesShortcut({ ...ctrlAltM, ctrlKey: false, metaKey: true }, modAltM, true)).toBe(
      true,
    );
  });

  it("requires the exact modifiers", () => {
    const altM = shortcut("m", { ctrlKey: true, altKey: true });
    expect(matchesShortcut({ ...ctrlAltM, shiftKey: true }, altM, false)).toBe(false);
  });

  it("matches the physical key when Alt changes the character", () => {
    expect(eventKeys(key({ key: "µ", code: "KeyM" }))).toEqual(new Set(["µ", "m"]));
    expect(eventKeys(key({ key: " ", code: "Space" }))).toEqual(new Set(["space"]));
  });
});

describe("evaluateWhen", () => {
  it("evaluates identifiers, not, and, or", () => {
    const context = { terminalFocus: true, editableFocus: false };
    expect(evaluateWhen(undefined, context)).toBe(true);
    expect(
      evaluateWhen({ type: "not", node: { type: "identifier", name: "terminalFocus" } }, context),
    ).toBe(false);
    expect(
      evaluateWhen(
        {
          type: "or",
          left: { type: "identifier", name: "editableFocus" },
          right: { type: "identifier", name: "true" },
        },
        context,
      ),
    ).toBe(true);
    expect(evaluateWhen({ type: "identifier", name: "unknownContext" }, context)).toBe(false);
  });
});

describe("resolveCommand", () => {
  const rules: ReadonlyArray<ResolvedRule> = [
    {
      command: "script.t3-mode-plugins.run",
      shortcut: shortcut("m", { modKey: true, altKey: true }),
    },
    {
      command: "terminal.something",
      shortcut: shortcut("m", { modKey: true, altKey: true }),
      whenAst: { type: "identifier", name: "terminalFocus" },
    },
  ];

  it("lets the last matching rule win, like T3 Code", () => {
    expect(resolveCommand(ctrlAltM, rules, { terminalFocus: true }, false)).toBe(
      "terminal.something",
    );
    expect(resolveCommand(ctrlAltM, rules, { terminalFocus: false }, false)).toBe(
      "script.t3-mode-plugins.run",
    );
  });

  it("returns null when nothing matches", () => {
    expect(resolveCommand(key({ key: "x", ctrlKey: true }), rules, {}, false)).toBeNull();
  });

  it("recognizes T3 Code's resolved rules", () => {
    expect(isResolvedRules(rules)).toBe(true);
    expect(isResolvedRules([{ command: "x" }])).toBe(false);
    expect(isResolvedRules([])).toBe(false);
  });
});
