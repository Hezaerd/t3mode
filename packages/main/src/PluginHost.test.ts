// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePathLayer from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { FetchHttpClient } from "effect/http";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { PluginAction } from "@t3mode/shared/Ipc";
import { homeLayout } from "@t3mode/shared/Layout";

import * as Files from "./Files.ts";
import { Home } from "./Home.ts";
import { PluginActionSchema, make } from "./PluginHost.ts";

const decode = Schema.decodeUnknownSync(PluginActionSchema);

describe("PluginActionSchema", () => {
  it("accepts the Plugins page's actions", () => {
    const actions: ReadonlyArray<PluginAction> = [
      { _tag: "list" },
      { _tag: "preview", input: "owner/repo" },
      {
        _tag: "install",
        source: { kind: "github", owner: "owner", repo: "repo", tag: "v1.0.0" },
        id: "my-plugin",
      },
      { _tag: "update", id: "my-plugin" },
      { _tag: "remove", id: "my-plugin" },
      { _tag: "check" },
    ];
    for (const action of actions) expect(decode(action)).toEqual(action);
  });

  it("refuses a local source, so page code can't make main read a folder", () => {
    expect(() =>
      decode({ _tag: "install", source: { kind: "local", path: "C:/Users" }, id: "my-plugin" }),
    ).toThrow();
  });

  it("refuses ids and GitHub names that aren't safe", () => {
    for (const action of [
      { _tag: "remove", id: "../../Users" },
      { _tag: "update", id: "My Plugin" },
      { _tag: "install", source: { kind: "github", owner: "../x", repo: "repo" }, id: "a" },
      { _tag: "install", source: { kind: "github", owner: "o", repo: "r", tag: "../x" }, id: "a" },
      { _tag: "link", path: "C:/dev" },
    ]) {
      expect(() => decode(action), JSON.stringify(action)).toThrow();
    }
  });
});

const build = (layout: ReturnType<typeof homeLayout>) =>
  Effect.runSync(
    make.pipe(
      Effect.provide(
        Layer.mergeAll(
          Files.layer,
          Layer.succeed(Home, Home.of({ layout })),
          NodeFileSystem.layer,
          NodePathLayer.layer,
          FetchHttpClient.layer,
        ),
      ),
    ),
  );

describe("PluginHost", () => {
  const roots: Array<string> = [];
  afterEach(() => {
    for (const root of roots.splice(0)) NodeFs.rmSync(root, { recursive: true, force: true });
  });

  const home = () => {
    const root = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "t3mode-host-"));
    roots.push(root);
    const layout = homeLayout(root);
    const plugin = NodePath.join(root, "dev");
    NodeFs.mkdirSync(plugin);
    NodeFs.mkdirSync(layout.dist);
    NodeFs.writeFileSync(layout.rendererJs, "/* runtime */");
    NodeFs.writeFileSync(
      NodePath.join(plugin, "manifest.json"),
      JSON.stringify({ id: "dev", name: "Dev", version: "1.0.0", description: "", api: 1 }),
    );
    NodeFs.writeFileSync(NodePath.join(plugin, "plugin.js"), "module.exports = {};");
    NodeFs.writeFileSync(
      layout.pluginsLock,
      JSON.stringify({
        version: 1,
        plugins: { dev: { source: { kind: "local", path: plugin }, version: "1.0.0" } },
      }),
    );
    return layout;
  };

  it("builds synchronously and runs renderer.js after every plugin", async () => {
    const host = build(home());
    const scripts = await Effect.runPromise(host.pageScripts);
    expect(scripts.map((script) => script.name)).toEqual([
      "t3mode-plugin/dev.js",
      "t3mode-renderer.js",
    ]);
    expect(scripts[1]?.code).toBe("/* runtime */");
    expect(await Effect.runPromise(host.pluginScript("dev"))).toEqual(scripts[0]);
    expect(await Effect.runPromise(host.pluginScript("other"))).toBeNull();
  });

  it("still sends renderer.js when plugins.json is broken", async () => {
    const layout = home();
    NodeFs.writeFileSync(layout.pluginsLock, "{ not json");
    const scripts = await Effect.runPromise(build(layout).pageScripts);
    expect(scripts.map((script) => script.name)).toEqual(["t3mode-renderer.js"]);
  });

  it("answers the page's actions, and refuses what doesn't decode", async () => {
    const host = build(home());
    const listed = (await Effect.runPromise(host.act({ _tag: "list" }))) as ReadonlyArray<{
      readonly id: string;
    }>;
    expect(listed.map((plugin) => plugin.id)).toEqual(["dev"]);
    expect(await Effect.runPromise(host.act({ _tag: "remove", id: "missing" }))).toEqual({
      ok: true,
      value: "not-installed",
    });
    expect(await Effect.runPromise(host.act({ _tag: "update", id: "dev" }))).toEqual({
      ok: false,
      error: expect.stringContaining("is linked from"),
    });
    await expect(
      Effect.runPromise(
        host.act({ _tag: "install", source: { kind: "local", path: "C:/Users" }, id: "dev" }),
      ),
    ).rejects.toThrow();
  });
});
