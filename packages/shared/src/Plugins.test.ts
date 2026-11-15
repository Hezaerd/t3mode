// @effect-diagnostics nodeBuiltinImport:off
import * as NodeVm from "node:vm";

import { describe, expect, it } from "vite-plus/test";

import {
  type PluginRegistration,
  parseGithubSource,
  pluginScriptName,
  releaseAssetUrl,
  sameSource,
  sourceLabel,
  wrapPluginCode,
} from "./Plugins.ts";

describe("parseGithubSource", () => {
  const repo = { kind: "github", owner: "some-owner", repo: "my.plugin_1" };

  it("accepts the forms a user pastes", () => {
    for (const input of [
      "some-owner/my.plugin_1",
      "  some-owner/my.plugin_1/ ",
      "github.com/some-owner/my.plugin_1",
      "https://github.com/some-owner/my.plugin_1",
      "https://github.com/some-owner/my.plugin_1/",
      "https://github.com/some-owner/my.plugin_1.git",
      "https://www.github.com/some-owner/my.plugin_1",
      "HTTPS://GitHub.com/some-owner/my.plugin_1",
    ]) {
      expect(parseGithubSource(input), input).toEqual(repo);
    }
  });

  it("pins a tag from @tag or a release tag URL", () => {
    const pinned = { ...repo, tag: "v1.2.0-beta.1" };
    expect(parseGithubSource("some-owner/my.plugin_1@v1.2.0-beta.1")).toEqual(pinned);
    expect(parseGithubSource("github.com/some-owner/my.plugin_1@v1.2.0-beta.1")).toEqual(pinned);
    expect(
      parseGithubSource("https://github.com/some-owner/my.plugin_1/releases/tag/v1.2.0-beta.1"),
    ).toEqual(pinned);
    expect(
      parseGithubSource("https://github.com/some-owner/my.plugin_1/releases/tag/v1.2.0-beta.1/"),
    ).toEqual(pinned);
  });

  it("rejects anything else", () => {
    for (const input of [
      "",
      "owner",
      "owner/",
      "/repo",
      "owner/repo/extra",
      "-owner/repo",
      "owner-/repo",
      "own_er/repo",
      "owner/..",
      "owner/re po",
      "owner/repo@",
      "owner/repo@-tag",
      "owner/repo@v1/../../x",
      "owner/repo@v1@v2",
      "https://gitlab.com/owner/repo",
      "gitlab.com/owner/repo",
      "https://github.com.evil.example/owner/repo",
      "git@github.com:owner/repo.git",
      "file:///C:/plugins/repo",
      "C:\\plugins\\repo",
      "https://github.com/owner",
      "https://github.com/owner/repo/tree/main",
      "https://github.com/owner/repo/releases",
      "https://github.com/owner/repo/releases/tag/",
      "https://github.com/owner/repo/releases/tag/%2e%2e%2f",
      "https://github.com/owner/repo?tab=readme",
      `${"a".repeat(40)}/repo`,
    ]) {
      expect(parseGithubSource(input), input).toBeUndefined();
    }
  });
});

describe("releaseAssetUrl", () => {
  it("uses the latest release unless the source is pinned", () => {
    const source = { kind: "github", owner: "o", repo: "r" } as const;
    expect(releaseAssetUrl("https://github.com", source, "plugin.js")).toBe(
      "https://github.com/o/r/releases/latest/download/plugin.js",
    );
    expect(releaseAssetUrl("http://127.0.0.1:9/", { ...source, tag: "v1.0.0" }, "a b.js")).toBe(
      "http://127.0.0.1:9/o/r/releases/download/v1.0.0/a%20b.js",
    );
  });

  it("encodes every segment", () => {
    const source = { kind: "github", owner: "o?", repo: "r#", tag: "v1/../x" } as const;
    expect(releaseAssetUrl("https://github.com", source, "f")).toBe(
      "https://github.com/o%3F/r%23/releases/download/v1%2F..%2Fx/f",
    );
  });
});

describe("sources", () => {
  it("labels and compares them", () => {
    const github = { kind: "github", owner: "Owner", repo: "Repo" } as const;
    expect(sourceLabel({ ...github, tag: "v2" })).toBe("Owner/Repo@v2");
    expect(sourceLabel({ kind: "local", path: "C:\\dev\\p" })).toBe("linked from C:\\dev\\p");
    expect(sameSource(github, { kind: "github", owner: "owner", repo: "repo", tag: "v1" })).toBe(
      true,
    );
    expect(sameSource(github, { kind: "github", owner: "owner", repo: "other" })).toBe(false);
    expect(sameSource(github, { kind: "local", path: "Owner/Repo" })).toBe(false);
  });
});

/** Runs a page script in a fresh context with a fake `window`, as the preload does. */
const runInPage = (code: string, window: Record<string, unknown> = {}) => {
  NodeVm.runInNewContext(code, { window });
  return window["__t3modePlugins"] as Array<PluginRegistration>;
};

describe("wrapPluginCode", () => {
  const start = "function start() {}";

  it("registers a module.exports bundle without running it", () => {
    const window: Record<string, unknown> = {};
    const code = `window.ran = true;\nmodule.exports = { options: {}, start: ${start} };`;
    const [registration] = runInPage(wrapPluginCode("my-plugin", code), window);
    expect(registration?.id).toBe("my-plugin");
    expect(window["ran"]).toBeUndefined();
    const exported = registration!.load() as { start: unknown };
    expect(window["ran"]).toBe(true);
    expect(typeof exported.start).toBe("function");
  });

  it("registers an exports.default bundle", () => {
    const code = `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.default = { options: {}, start: ${start} };`;
    const [registration] = runInPage(wrapPluginCode("esm-style", code));
    const exported = registration!.load() as { default: { start: unknown } };
    expect(typeof exported.default.start).toBe("function");
  });

  it("survives a bundle that ends in a line comment", () => {
    const code = `module.exports = { options: {}, start: ${start} };\n//# sourceMappingURL=plugin.js.map`;
    const [registration] = runInPage(wrapPluginCode("commented", code));
    expect(registration!.load()).toHaveProperty("start");
  });

  it("appends to registrations that are already there", () => {
    const window = { __t3modePlugins: [{ id: "first", load: () => undefined }] };
    const registrations = runInPage(wrapPluginCode("second", "module.exports = {};"), window);
    expect(registrations.map((item) => item.id)).toEqual(["first", "second"]);
  });

  it("throws a broken top level only when the plugin is loaded", () => {
    const [registration] = runInPage(wrapPluginCode("broken", 'throw new Error("top level");'));
    expect(registration?.id).toBe("broken");
    expect(() => registration!.load()).toThrow("top level");
  });

  it("refuses an id that could escape the generated code", () => {
    for (const id of ['x", load: 1}); alert(1); ({"', "Upper", "-lead", "", "a".repeat(65)]) {
      expect(() => wrapPluginCode(id, "")).toThrow("Invalid plugin id");
    }
  });

  it("names the script for DevTools", () => {
    expect(pluginScriptName("my-plugin")).toBe("t3mode-plugin/my-plugin.js");
  });
});
