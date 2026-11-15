import { describe, expect, it } from "vite-plus/test";

import { SHORTCUT_COMMAND } from "@t3mode/shared/Shortcut";

import { defaultKeyTaken, hasShortcut, normalizeKey } from "./T3Keybindings.ts";

describe("normalizeKey", () => {
  it("resolves mod per platform and ignores modifier order and case", () => {
    expect(normalizeKey("mod+alt+m", "win32")).toBe("alt+ctrl+m");
    expect(normalizeKey("Alt+Control+M", "win32")).toBe("alt+ctrl+m");
    expect(normalizeKey("mod+alt+m", "darwin")).toBe("alt+meta+m");
    expect(normalizeKey("cmd+option+m", "darwin")).toBe("alt+meta+m");
  });
});

describe("defaultKeyTaken", () => {
  it("is true only for an unconditional rule on the same key", () => {
    expect(defaultKeyTaken([{ key: "ctrl+alt+m", command: "x" }], "win32")).toBe(true);
    expect(
      defaultKeyTaken([{ key: "ctrl+alt+m", command: "x", when: "terminalFocus" }], "win32"),
    ).toBe(false);
    expect(defaultKeyTaken([{ key: "ctrl+alt+n", command: "x" }, "junk", null], "win32")).toBe(
      false,
    );
  });
});

describe("hasShortcut", () => {
  it("finds T3 Mode's command among any entries", () => {
    expect(hasShortcut([42, { key: "mod+alt+y", command: SHORTCUT_COMMAND }])).toBe(true);
    expect(hasShortcut([{ key: "mod+alt+m", command: "sidebar.toggle" }])).toBe(false);
  });
});
