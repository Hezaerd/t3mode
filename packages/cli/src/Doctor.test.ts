import { FuseState, FuseV1Options } from "@electron/fuses";
import { describe, expect, it } from "vite-plus/test";

import { T3_UPDATER_OFF_ENV } from "@t3mode/shared/Layout";
import { T3_HOOKS } from "@t3mode/shared/T3Hooks";

import { checks, hasToken, type T3Facts } from "./Doctor.ts";

const good = <A>(value: A) => ({ ok: true as const, value });
const missing = { ok: false as const, reason: "fixture missing" };
const facts: T3Facts = {
  exe: "T3 Code.exe",
  fuses: good({
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FuseState.DISABLE,
    [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.DISABLE,
    [FuseV1Options.RunAsNode]: FuseState.ENABLE,
  }),
  original: good({ path: "_app.asar", pkg: { main: "apps/boot.cjs" }, files: ["apps/boot.cjs"] }),
  desktop: good(`process.env.${T3_UPDATER_OFF_ENV}; expose("desktopBridge")`),
  update: good(
    "provider: github\nowner: pingdotgg\nrepo: t3code\npublisherName:\n  - T3 Tools Inc",
  ),
  client: good(
    Object.values(T3_HOOKS)
      .map((hook) => `"${hook.attribute}" ${"value" in hook ? `\`${hook.value}\`` : ""}`)
      .join("\n"),
  ),
  server: good("isScriptRunCommand(`script.${script.id}.run`)"),
};

const failures: Readonly<Record<string, Partial<T3Facts>>> = {
  integrity: {
    fuses: good({ [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FuseState.ENABLE }),
  },
  "asar-only": { fuses: good({ [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.ENABLE }) },
  "run-as-node": { fuses: good({ [FuseV1Options.RunAsNode]: FuseState.DISABLE }) },
  original: { original: good({ path: "app.asar", pkg: { main: "missing.cjs" }, files: [] }) },
  "updater-off": { desktop: good("unrelated") },
  bridge: { desktop: good("unrelated") },
  "update-feed": { update: good("provider: github\nowner: pingdotgg\nrepo: t3code") },
  "script-command": { server: good("isScriptRunCommand(`other.${script.id}.run`)") },
};

describe("doctor checks", () => {
  for (const check of checks) {
    it(`${check.id} passes`, () => expect(check.run(facts).ok).toBe(true));
    it(`${check.id} fails when the fact changes`, () => {
      const changed = failures[check.id] ?? { client: good("") };
      expect(check.run({ ...facts, ...changed }).ok).toBe(false);
    });
    it(`${check.id} preserves the missing piece reason`, () => {
      expect(
        check.run({
          exe: facts.exe,
          fuses: missing,
          original: missing,
          desktop: missing,
          update: missing,
          client: missing,
          server: missing,
        }),
      ).toEqual({ ok: false, detail: missing.reason });
    });
  }
  it("rejects missing main and disabled or absent fuse states", () => {
    expect(
      checks
        .find((check) => check.id === "original")!
        .run({ ...facts, original: good({ path: "app.asar", pkg: {}, files: [] }) }).ok,
    ).toBe(false);
    for (const check of checks.slice(0, 3))
      expect(check.run({ ...facts, fuses: good({}) }).ok).toBe(false);
  });
  it("does not require attributes and values to form a literal pair", () => {
    expect(
      checks
        .find((check) => check.id === "dom-nav")!
        .run({ ...facts, client: good('"data-workspace-area":e;oe(`settings-nav`,x)') }).ok,
    ).toBe(true);
  });
});

describe("whole string tokens in minified JavaScript", () => {
  it.each([
    ['"data-settings-section":e', "data-settings-section"],
    ["`[data-settings-section]`", "data-settings-section"],
    ['"data-keybinding-capture":``', "data-keybinding-capture"],
    ["oe(`settings-nav`,x)", "settings-nav"],
    ["`keybinding-${e}`", "keybinding-"],
    ["'[data-workspace-area=settings-nav]'", "settings-nav"],
  ])("matches %s", (text, token) => expect(hasToken(text, token)).toBe(true));
  it.each([
    "settings-nav-group",
    '"settings-nav-group"',
    '"prefix-settings-nav"',
    '"settings-nav.suffix"',
  ])("rejects %s", (text) => expect(hasToken(text, "settings-nav")).toBe(false));
});
