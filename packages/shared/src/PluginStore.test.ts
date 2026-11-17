// PluginStore end to end: a local HTTP server stands in for GitHub's release downloads, and a
// temp folder is the t3mode home.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import { FetchHttpClient } from "effect/http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { homeLayout } from "./Layout.ts";
import * as PluginStore from "./PluginStore.ts";
import {
  accessGrew,
  declaredAccess,
  type GithubSource,
  MAX_PLUGIN_CODE_BYTES,
  MAX_PLUGIN_SCRIPT_BYTES,
  NO_ACCESS,
} from "./Plugins.ts";

const assets = new Map<string, string | Uint8Array | ReadonlyArray<Uint8Array>>();
let server: NodeHttp.Server;
let base = "";

beforeAll(async () => {
  server = NodeHttp.createServer((request, response) => {
    const body = assets.get(request.url ?? "");
    if (body === undefined) {
      response.writeHead(404).end("Not Found");
      return;
    }
    response.writeHead(200, { "content-type": "application/octet-stream" });
    if (typeof body === "string" || body instanceof Uint8Array) {
      response.end(body);
      return;
    }
    for (const chunk of body) response.write(chunk);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => assets.clear());

const manifest = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "my-plugin",
    name: "My Plugin",
    version: "1.0.0",
    description: "Does a thing.",
    author: "someone",
    api: 1,
    ...fields,
  });

const CODE = "module.exports = { options: {}, start() {} };\n";

const publish = (
  repo: string,
  files: {
    readonly manifest?: string;
    readonly registry?: Record<string, string>;
    readonly plugins?: Record<string, { readonly manifest?: string; readonly code?: string }>;
    readonly code?: string | Uint8Array | ReadonlyArray<Uint8Array>;
  },
  tag?: string,
) => {
  const release = tag === undefined ? "releases/latest/download" : `releases/download/${tag}`;
  if (files.manifest !== undefined) assets.set(`/${repo}/${release}/manifest.json`, files.manifest);
  if (files.registry !== undefined)
    assets.set(`/${repo}/${release}/t3mode.json`, JSON.stringify({ plugins: files.registry }));
  for (const [id, plugin] of Object.entries(files.plugins ?? {})) {
    if (plugin.manifest !== undefined)
      assets.set(`/${repo}/${release}/${id}.manifest.json`, plugin.manifest);
    if (plugin.code !== undefined) assets.set(`/${repo}/${release}/${id}.plugin.js`, plugin.code);
  }
  if (files.code !== undefined) assets.set(`/${repo}/${release}/plugin.js`, files.code);
};

const github = (repo: string, tag?: string): GithubSource => {
  const [owner = "", name = ""] = repo.split("/");
  return { kind: "github", owner, repo: name, ...(tag === undefined ? {} : { tag }) };
};

const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

const PlatformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, FetchHttpClient.layer);

const withStore = <A, E>(
  body: (context: {
    readonly store: PluginStore.PluginStore["Service"];
    readonly home: ReturnType<typeof homeLayout>;
    readonly fs: FileSystem.FileSystem;
    readonly path: Path.Path;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = homeLayout(yield* fs.makeTempDirectoryScoped({ prefix: "t3mode-plugins-" }));
      const store = yield* PluginStore.make({ layout: home, githubBase: base });
      return yield* body({ store, home, fs, path });
    }).pipe(Effect.scoped, Effect.provide(PlatformLayer)),
  );

const failure = <A>(effect: Effect.Effect<A, PluginStore.PluginError>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.message),
  );

describe("PluginStore", () => {
  it("previews registry offers independently and prefers a standalone manifest", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        publish("someone/mono", {
          registry: { alpha: "a/dist", missing: "b/dist", wrong: "c/dist" },
          plugins: {
            alpha: { manifest: manifest({ id: "alpha" }), code: CODE },
            wrong: { manifest: manifest({ id: "other" }) },
          },
        });
        const preview = yield* store.preview("someone/mono");
        expect(preview.repo).toEqual(github("someone/mono"));
        expect(preview.offers).toEqual([
          {
            kind: "ready",
            source: { ...github("someone/mono"), plugin: "alpha" },
            manifest: JSON.parse(manifest({ id: "alpha" })),
          },
          {
            kind: "unavailable",
            id: "missing",
            reason: expect.stringContaining(
              "No missing.manifest.json in the latest release of someone/mono. Check the link, and that the release has missing.manifest.json and missing.plugin.js.",
            ),
          },
          {
            kind: "unavailable",
            id: "wrong",
            reason: expect.stringContaining('"other" instead of "wrong"'),
          },
        ]);
        publish("someone/mono", { manifest: manifest() });
        expect((yield* store.preview("someone/mono")).offers).toEqual([
          { kind: "ready", source: github("someone/mono"), manifest: JSON.parse(manifest()) },
        ]);
      }),
    ));

  it("installs and updates registry assets while retaining their source", () =>
    withStore(({ store, fs, home, path }) =>
      Effect.gen(function* () {
        const source = { ...github("someone/mono"), plugin: "alpha" };
        publish("someone/mono", {
          registry: { alpha: "a/dist" },
          plugins: { alpha: { manifest: manifest({ id: "alpha" }), code: CODE } },
        });
        yield* store.install(source, "alpha", NO_ACCESS);
        expect(JSON.parse(yield* fs.readFileString(home.pluginsLock)).plugins.alpha.source).toEqual(
          source,
        );
        expect(yield* fs.readFileString(path.join(home.plugins, "alpha", "plugin.js"))).toBe(CODE);
        publish("someone/mono", {
          plugins: {
            alpha: {
              manifest: manifest({ id: "alpha", version: "2.0.0" }),
              code: "module.exports = {};",
            },
          },
        });
        expect(yield* store.checkUpdates).toEqual({ updates: { alpha: "2.0.0" }, failures: {} });
        expect((yield* store.update("alpha")).version).toBe("2.0.0");
        assets.delete("/someone/mono/releases/latest/download/alpha.manifest.json");
        expect(yield* store.checkUpdates).toEqual({
          updates: {},
          failures: { alpha: expect.stringContaining("No alpha.manifest.json") },
        });
      }),
    ));

  it("rejects invalid and empty registries", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        for (const registry of [
          { "Bad Key": "dist" },
          { alpha: "../dist" },
          { alpha: "/dist" },
          { alpha: "a\\dist" },
          { alpha: "a//dist" },
          { alpha: "a/./dist" },
          { alpha: "" },
          { alpha: "C:/dist" },
          {},
          Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`plugin-${i}`, `plugins/${i}`])),
        ]) {
          publish("someone/mono", { registry });
          expect(yield* failure(store.preview("someone/mono"))).toContain("Invalid t3mode.json");
        }
      }),
    ));

  it("rejects unreadable, malformed and oversized registry downloads", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        assets.set("/someone/mono/releases/latest/download/t3mode.json", "{ invalid");
        expect(yield* failure(store.preview("someone/mono"))).toContain("Invalid t3mode.json");
        assets.set("/someone/mono/releases/latest/download/t3mode.json", " ".repeat(65537));
        expect(yield* failure(store.preview("someone/mono"))).toContain("larger than 64 KB");
      }),
    ));

  it("keeps API, decode and source conflicts local to registry offers", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        publish("someone/original", { manifest: manifest({ id: "taken" }), code: CODE });
        yield* store.install(github("someone/original"), "taken", NO_ACCESS);
        publish("someone/mono", {
          registry: { taken: "taken", incompatible: "incompatible", broken: "broken" },
          plugins: {
            taken: { manifest: manifest({ id: "taken" }) },
            incompatible: { manifest: manifest({ id: "incompatible", api: 2 }) },
            broken: { manifest: "{}" },
          },
        });
        expect((yield* store.preview("someone/mono")).offers).toEqual([
          {
            kind: "unavailable",
            id: "taken",
            reason: expect.stringContaining("already installed"),
          },
          {
            kind: "unavailable",
            id: "incompatible",
            reason: expect.stringContaining("plugin API 2"),
          },
          { kind: "unavailable", id: "broken", reason: expect.stringContaining("manifest.json") },
        ]);
      }),
    ));

  it("links every registry route and leaves the lock unchanged when one fails", () =>
    withStore(({ store, fs, path, home }) =>
      Effect.gen(function* () {
        const folder = yield* fs.makeTempDirectoryScoped();
        for (const id of ["alpha", "beta"]) {
          yield* fs.makeDirectory(path.join(folder, id, "dist"), { recursive: true });
          yield* fs.writeFileString(
            path.join(folder, id, "dist", "manifest.json"),
            manifest({ id }),
          );
          yield* fs.writeFileString(path.join(folder, id, "dist", "plugin.js"), CODE);
        }
        const registry = path.join(folder, "t3mode.json");
        yield* fs.writeFileString(
          registry,
          JSON.stringify({ plugins: { alpha: "alpha/dist", beta: "missing/dist" } }),
        );
        expect(yield* failure(store.link(folder))).toContain("no readable manifest.json");
        expect(yield* fs.exists(home.pluginsLock)).toBe(false);
        yield* fs.writeFileString(
          registry,
          JSON.stringify({ plugins: { alpha: "alpha/dist", beta: "beta/dist" } }),
        );
        expect((yield* store.link(folder)).map((plugin) => plugin.id)).toEqual(["alpha", "beta"]);
        const lock = yield* fs.readFileString(home.pluginsLock);
        yield* fs.writeFileString(
          path.join(folder, "beta", "dist", "manifest.json"),
          manifest({ id: "wrong" }),
        );
        expect(yield* failure(store.link(folder))).toContain('"wrong" instead of "beta"');
        expect(yield* fs.readFileString(home.pluginsLock)).toBe(lock);
      }),
    ));

  it("previews a release without installing it", () =>
    withStore(({ store, fs, home }) =>
      Effect.gen(function* () {
        publish("someone/my-plugin", { manifest: manifest(), code: CODE });
        const preview = yield* store.preview("https://github.com/someone/my-plugin");
        expect(preview.repo).toEqual(github("someone/my-plugin"));
        expect(preview.offers[0]).toMatchObject({ kind: "ready" });
        expect(
          preview.offers[0]?.kind === "ready" ? preview.offers[0].manifest : undefined,
        ).toMatchObject({ id: "my-plugin", version: "1.0.0", api: 1 });
        expect(yield* fs.exists(home.pluginsLock)).toBe(false);
        expect(yield* failure(store.preview("not a link"))).toContain("not a GitHub repository");
        expect(yield* failure(store.preview("someone/missing"))).toContain(
          "No manifest.json or t3mode.json in the latest release of someone/missing.",
        );
      }),
    ));

  it("installs a release: its files, then the lockfile entry", () =>
    withStore(({ store, fs, path, home }) =>
      Effect.gen(function* () {
        publish("someone/my-plugin", { manifest: manifest(), code: CODE });
        const installed = yield* store.install(github("someone/my-plugin"), "my-plugin", NO_ACCESS);
        expect(installed).toEqual({
          id: "my-plugin",
          name: "My Plugin",
          description: "Does a thing.",
          version: "1.0.0",
          author: "someone",
          source: github("someone/my-plugin"),
          sha256: sha256(CODE),
        });
        const folder = path.join(home.plugins, "my-plugin");
        expect(yield* fs.readFileString(path.join(folder, "plugin.js"))).toBe(CODE);
        expect(JSON.parse(yield* fs.readFileString(path.join(folder, "manifest.json")))).toEqual(
          JSON.parse(manifest()),
        );
        expect(JSON.parse(yield* fs.readFileString(home.pluginsLock))).toEqual({
          version: 1,
          plugins: {
            "my-plugin": {
              source: github("someone/my-plugin"),
              version: "1.0.0",
              sha256: sha256(CODE),
              files: { "plugin.js": sha256(CODE) },
              approved: { backend: false, mcp: false, sockets: [] },
            },
          },
        });
        expect(yield* store.list).toEqual([installed]);
        const script = yield* store.script("my-plugin");
        expect(script?.name).toBe("t3mode-plugin/my-plugin.js");
        expect(script?.code).toContain(CODE);
        expect(yield* store.scripts).toEqual([script]);
      }),
    ));

  it("ends in the same state when the same install runs twice", () =>
    withStore(({ store, fs, home }) =>
      Effect.gen(function* () {
        publish("someone/my-plugin", { manifest: manifest(), code: CODE });
        yield* store.install(github("someone/my-plugin"), "my-plugin", NO_ACCESS);
        const lock = yield* fs.readFileString(home.pluginsLock);
        const listed = yield* store.list;
        yield* store.install(github("someone/my-plugin"), "my-plugin", NO_ACCESS);
        expect(yield* fs.readFileString(home.pluginsLock)).toBe(lock);
        expect(yield* store.list).toEqual(listed);
      }),
    ));

  it("refuses a release whose id changed since the preview", () =>
    withStore(({ store, fs, home }) =>
      Effect.gen(function* () {
        publish("someone/my-plugin", { manifest: manifest(), code: CODE });
        const preview = yield* store.preview("someone/my-plugin");
        publish("someone/my-plugin", { manifest: manifest({ id: "other-plugin" }), code: CODE });
        const message = yield* failure(store.install(preview.repo, "my-plugin", NO_ACCESS));
        expect(message).toContain('"other-plugin" instead of "my-plugin"');
        expect(yield* fs.exists(home.pluginsLock)).toBe(false);
        expect(yield* fs.exists(home.plugins)).toBe(false);
      }),
    ));

  it("refuses a plugin built for another API, or with an id that isn't safe", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        publish("someone/future", { manifest: manifest({ api: 2 }), code: CODE });
        expect(yield* failure(store.preview("someone/future"))).toContain("plugin API 2");
        expect(
          yield* failure(store.install(github("someone/future"), "my-plugin", NO_ACCESS)),
        ).toContain("plugin API 2");
        for (const id of ["My_Plugin", "../escape", ""]) {
          publish("someone/bad-id", { manifest: manifest({ id }), code: CODE });
          expect(yield* failure(store.preview("someone/bad-id"))).toContain(
            "manifest.json in the latest release of someone/bad-id is invalid",
          );
        }
      }),
    ));

  it("refuses code over the size cap, with or without a length, and writes nothing", () =>
    withStore(({ store, fs, home }) =>
      Effect.gen(function* () {
        const chunk = new Uint8Array(1024 * 1024).fill(0x20);
        const chunked = [chunk, chunk, chunk, chunk, chunk, new Uint8Array([0x20])];
        const whole = new Uint8Array(MAX_PLUGIN_CODE_BYTES + 1).fill(0x20);
        for (const code of [whole, chunked]) {
          publish("someone/my-plugin", { manifest: manifest(), code });
          expect(
            yield* failure(store.install(github("someone/my-plugin"), "my-plugin", NO_ACCESS)),
          ).toContain("plugin.js in the latest release of someone/my-plugin is larger than 5 MB");
        }
        expect(yield* fs.exists(home.plugins)).toBe(false);
        expect(yield* fs.exists(home.pluginsLock)).toBe(false);

        publish("someone/my-plugin", { manifest: manifest(), code: chunked.slice(0, 5) });
        const installed = yield* store.install(github("someone/my-plugin"), "my-plugin", NO_ACCESS);
        expect(installed.error).toBeUndefined();
      }),
    ));

  it("treats an id named like an Object property as any other id", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        expect(yield* store.remove("constructor")).toBe("not-installed");
        publish("someone/odd", { manifest: manifest({ id: "constructor" }), code: CODE });
        yield* store.preview("someone/odd");
        const installed = yield* store.install(github("someone/odd"), "constructor", NO_ACCESS);
        expect(installed.error).toBeUndefined();
        expect(yield* store.checkUpdates).toEqual({ updates: {}, failures: {} });
        expect(yield* store.remove("constructor")).toBe("removed");
      }),
    ));

  it("won't load code that changed on disk after the install", () =>
    withStore(({ store, fs, path, home }) =>
      Effect.gen(function* () {
        publish("someone/my-plugin", { manifest: manifest(), code: CODE });
        yield* store.install(github("someone/my-plugin"), "my-plugin", NO_ACCESS);
        yield* fs.writeFileString(
          path.join(home.plugins, "my-plugin", "plugin.js"),
          `${CODE}stealCookies();\n`,
        );
        const [listed] = yield* store.list;
        expect(listed?.error).toBe("plugin.js changed since it was installed. Install it again.");
        expect(yield* store.script("my-plugin")).toBeUndefined();
        expect(yield* store.scripts).toEqual([]);
      }),
    ));

  it("reads an unreadable plugins.json as empty, and refuses to write over it", () =>
    withStore(({ store, fs, home }) =>
      Effect.gen(function* () {
        yield* fs.writeFileString(home.pluginsLock, '{ "version": 1, "plugins": { "../x": {} } }');
        expect(yield* store.list).toEqual([]);
        publish("someone/my-plugin", { manifest: manifest(), code: CODE });
        expect(
          yield* failure(store.install(github("someone/my-plugin"), "my-plugin", NO_ACCESS)),
        ).toContain("plugins.json is invalid");
      }),
    ));

  it("links a plugin folder, and links it again to the same entry", () =>
    withStore(({ store, fs, path, home }) =>
      Effect.gen(function* () {
        const folder = path.join(home.root, "dev", "dist");
        yield* fs.makeDirectory(folder, { recursive: true });
        yield* fs.writeFileString(path.join(folder, "manifest.json"), manifest());
        expect(yield* failure(store.link(folder))).toContain("has no plugin.js");
        yield* fs.writeFileString(path.join(folder, "plugin.js"), CODE);

        const [linked] = yield* store.link(path.join(folder, "..", "dist"));
        expect(linked?.source).toEqual({ kind: "local", path: folder });
        expect(linked?.error).toBeUndefined();
        const lock = yield* fs.readFileString(home.pluginsLock);
        yield* store.link(folder);
        expect(yield* fs.readFileString(home.pluginsLock)).toBe(lock);

        yield* fs.writeFileString(path.join(folder, "plugin.js"), `${CODE}// rebuilt\n`);
        expect((yield* store.script("my-plugin"))?.code).toContain("// rebuilt");
      }),
    ));

  it("refuses an id that is installed from another source", () =>
    withStore(({ store, fs, path, home }) =>
      Effect.gen(function* () {
        const folder = path.join(home.root, "dev");
        yield* fs.makeDirectory(folder, { recursive: true });
        yield* fs.writeFileString(path.join(folder, "manifest.json"), manifest());
        yield* fs.writeFileString(path.join(folder, "plugin.js"), CODE);
        publish("someone/my-plugin", { manifest: manifest(), code: CODE });
        publish("other/fork", { manifest: manifest(), code: CODE });

        yield* store.install(github("someone/my-plugin"), "my-plugin", NO_ACCESS);
        expect(yield* failure(store.link(folder))).toContain(
          '"my-plugin" is already installed (someone/my-plugin)',
        );
        expect(yield* failure(store.preview("other/fork"))).toContain("already installed");
        expect(
          yield* failure(store.install(github("other/fork"), "my-plugin", NO_ACCESS)),
        ).toContain("already installed");

        yield* store.remove("my-plugin");
        yield* store.link(folder);
        expect(
          yield* failure(store.install(github("someone/my-plugin"), "my-plugin", NO_ACCESS)),
        ).toContain(`already installed (linked from ${folder})`);
      }),
    ));

  it("removes a GitHub plugin with its folder, and a linked one without its folder", () =>
    withStore(({ store, fs, path, home }) =>
      Effect.gen(function* () {
        publish("someone/my-plugin", { manifest: manifest(), code: CODE });
        yield* store.install(github("someone/my-plugin"), "my-plugin", NO_ACCESS);
        yield* fs.makeDirectory(home.pluginData, { recursive: true });
        const dataFile = path.join(home.pluginData, "my-plugin.json");
        const otherFile = path.join(home.pluginData, "other.json");
        yield* fs.writeFileString(dataFile, '{"count":1}');
        yield* fs.writeFileString(otherFile, '{"count":2}');
        expect(yield* store.remove("my-plugin")).toBe("removed");
        expect(yield* fs.exists(dataFile)).toBe(false);
        expect(yield* fs.readFileString(otherFile)).toBe('{"count":2}');
        expect(yield* store.list).toEqual([]);
        expect(yield* fs.exists(path.join(home.plugins, "my-plugin"))).toBe(false);
        expect(yield* store.remove("my-plugin")).toBe("not-installed");

        const folder = path.join(home.root, "dev");
        yield* fs.makeDirectory(folder, { recursive: true });
        yield* fs.writeFileString(path.join(folder, "manifest.json"), manifest());
        yield* fs.writeFileString(path.join(folder, "plugin.js"), CODE);
        yield* store.link(folder);
        yield* fs.writeFileString(dataFile, '{"count":3}');
        expect(yield* store.remove("my-plugin")).toBe("removed");
        expect(yield* fs.exists(dataFile)).toBe(false);
        expect(yield* fs.exists(path.join(folder, "plugin.js"))).toBe(true);
        yield* store.link(folder);
        expect(yield* store.remove("my-plugin")).toBe("removed");
      }),
    ));

  it("finds newer releases of unpinned plugins, and updates them", () =>
    withStore(({ store, fs, path, home }) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(home.pluginData, { recursive: true });
        const dataFile = path.join(home.pluginData, "my-plugin.json");
        yield* fs.writeFileString(dataFile, '{"count":1}');
        publish("someone/my-plugin", { manifest: manifest(), code: CODE });
        publish(
          "someone/pinned",
          { manifest: manifest({ id: "pinned", name: "Pinned" }), code: CODE },
          "v1.0.0",
        );
        yield* store.install(github("someone/my-plugin"), "my-plugin", NO_ACCESS);
        yield* store.install(github("someone/pinned", "v1.0.0"), "pinned", NO_ACCESS);
        expect(yield* store.checkUpdates).toEqual({ updates: {}, failures: {} });

        const newer = `${CODE}// 1.1.0\n`;
        publish("someone/my-plugin", { manifest: manifest({ version: "1.1.0" }), code: newer });
        publish("someone/pinned", { manifest: manifest({ id: "pinned", version: "2.0.0" }) });
        expect(yield* store.checkUpdates).toEqual({
          updates: { "my-plugin": "1.1.0" },
          failures: {},
        });

        expect(yield* fs.readFileString(dataFile)).toBe('{"count":1}');
        const updated = yield* store.update("my-plugin");
        expect(yield* fs.readFileString(dataFile)).toBe('{"count":1}');
        expect(updated).toMatchObject({ version: "1.1.0", sha256: sha256(newer) });
        expect(yield* store.checkUpdates).toEqual({ updates: {}, failures: {} });
        expect(yield* failure(store.update("pinned"))).toContain("pinned to v1.0.0");
      }),
    ));

  it("moves a plugin to its repo's registry on reinstall, keeping its data", () =>
    withStore(({ store, fs, path, home }) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(home.pluginData, { recursive: true });
        const dataFile = path.join(home.pluginData, "my-plugin.json");
        yield* fs.writeFileString(dataFile, '{"count":1}');
        publish("someone/my-plugin", { manifest: manifest(), code: CODE });
        yield* store.install(github("someone/my-plugin"), "my-plugin", NO_ACCESS);

        assets.clear();
        publish("someone/my-plugin", {
          registry: { "my-plugin": "my-plugin/dist" },
          plugins: { "my-plugin": { manifest: manifest({ version: "1.1.0" }), code: CODE } },
        });
        expect((yield* store.checkUpdates).failures["my-plugin"]).toContain(
          "No manifest.json in the latest release of someone/my-plugin.",
        );

        const [offer] = (yield* store.preview("someone/my-plugin")).offers;
        expect(offer).toMatchObject({ kind: "ready", source: { plugin: "my-plugin" } });
        if (offer?.kind !== "ready") return;
        expect((yield* store.install(offer.source, "my-plugin", NO_ACCESS)).version).toBe("1.1.0");
        expect(yield* fs.readFileString(dataFile)).toBe('{"count":1}');
        expect(yield* store.checkUpdates).toEqual({ updates: {}, failures: {} });
      }),
    ));
});

describe("program packaging", () => {
  it("pins every binary and script, refuses access growth, and removes obsolete files", () =>
    withStore(({ store, fs, path, home }) =>
      Effect.gen(function* () {
        publish("someone/program", {
          manifest: manifest({
            backend: "backend.cjs",
            mcp: "mcp.js",
            files: ["native.node", "backend.cjs"],
          }),
          code: CODE,
        });
        const contents = {
          "backend.cjs": "backend",
          "mcp.js": "mcp",
          "native.node": new Uint8Array([0, 255, 128]),
        };
        for (const [name, bytes] of Object.entries(contents))
          assets.set(`/someone/program/releases/latest/download/${name}`, bytes);
        yield* store.install(github("someone/program"), "my-plugin", {
          backend: true,
          mcp: true,
          sockets: [],
        });
        const folder = path.join(home.plugins, "my-plugin");
        const installed = JSON.parse(yield* fs.readFileString(home.pluginsLock)).plugins[
          "my-plugin"
        ];
        expect(installed).toMatchObject({
          backend: "backend.cjs",
          mcp: "mcp.js",
          approved: { backend: true, mcp: true, sockets: [] },
        });
        expect(Object.keys(installed.files).toSorted()).toEqual([
          "backend.cjs",
          "mcp.js",
          "native.node",
          "plugin.js",
        ]);
        for (const [name, bytes] of Object.entries(contents)) {
          expect(installed.files[name]).toBe(
            NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
          );
          expect(new Uint8Array(yield* fs.readFile(path.join(folder, name)))).toEqual(
            typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes,
          );
        }
        const before = yield* fs.readFileString(home.pluginsLock);
        publish("someone/program", {
          manifest: manifest({ version: "1.1.0", sockets: ["new-*"] }),
          code: CODE,
        });
        const refused = yield* store.update("my-plugin").pipe(Effect.flip);
        expect(refused.approval?.sockets).toEqual(["new-*"]);
        expect(yield* fs.readFileString(home.pluginsLock)).toBe(before);
        const changed = yield* store
          .update("my-plugin", { backend: false, mcp: false, sockets: [] })
          .pipe(Effect.flip);
        expect(changed.approval?.sockets).toEqual(["new-*"]);
        yield* store.update("my-plugin", refused.approval ?? NO_ACCESS);

        expect(yield* fs.readDirectory(folder)).toEqual(
          expect.arrayContaining(["plugin.js", "manifest.json"]),
        );
        expect(yield* fs.exists(path.join(folder, "native.node"))).toBe(false);
        yield* store.remove("my-plugin");
        expect(yield* fs.exists(folder)).toBe(false);
      }),
    ));

  it("refuses an install whose release asks for more access than the prompt showed", () =>
    withStore(({ store, fs, home }) =>
      Effect.gen(function* () {
        publish("someone/program", { manifest: manifest({ backend: "backend.cjs" }), code: CODE });
        assets.set("/someone/program/releases/latest/download/backend.cjs", "backend");
        const refused = yield* store
          .install(github("someone/program"), "my-plugin", {
            backend: false,
            mcp: false,
            sockets: [],
          })
          .pipe(Effect.flip);
        expect(refused.approval).toEqual({ backend: true, mcp: false, sockets: [] });
        expect(yield* fs.exists(home.pluginsLock)).toBe(false);
        yield* store.install(github("someone/program"), "my-plugin", refused.approval ?? NO_ACCESS);
        expect(
          JSON.parse(yield* fs.readFileString(home.pluginsLock)).plugins["my-plugin"].backend,
        ).toBe("backend.cjs");
      }),
    ));

  it("removes all pinned program files", () =>
    withStore(({ store, fs, path, home }) =>
      Effect.gen(function* () {
        publish("someone/program", {
          manifest: manifest({ backend: "b.js", mcp: "m.cjs", files: ["a.node"] }),
          code: CODE,
        });
        for (const name of ["b.js", "m.cjs", "a.node"])
          assets.set(`/someone/program/releases/latest/download/${name}`, "bytes");
        yield* store.install(github("someone/program"), "my-plugin", {
          backend: true,
          mcp: true,
          sockets: [],
        });
        yield* store.remove("my-plugin");
        expect(yield* fs.exists(path.join(home.plugins, "my-plugin"))).toBe(false);
        expect(JSON.parse(yield* fs.readFileString(home.pluginsLock)).plugins).toEqual({});
      }),
    ));

  it.each([
    { backend: "bad.node" },
    { mcp: "bad.exe" },
    { files: Array.from({ length: 21 }, (_, i) => `file${i}`) },
  ])("refuses invalid program declarations %j", (fields) =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        publish("someone/program", { manifest: manifest(fields), code: CODE });
        expect(yield* failure(store.preview("someone/program"))).toContain("invalid");
      }),
    ),
  );

  it("refuses an oversized script while streaming without a partial lockfile", () =>
    withStore(({ store, fs, home }) =>
      Effect.gen(function* () {
        publish("someone/program", { manifest: manifest({ backend: "backend.cjs" }), code: CODE });
        assets.set("/someone/program/releases/latest/download/backend.cjs", [
          new Uint8Array(MAX_PLUGIN_SCRIPT_BYTES),
          new Uint8Array(1),
        ]);
        expect(
          yield* failure(
            store.install(github("someone/program"), "my-plugin", {
              backend: true,
              mcp: false,
              sockets: [],
            }),
          ),
        ).toContain("larger than 20 MB");
        expect(yield* fs.exists(home.pluginsLock)).toBe(false);
      }),
    ));

  it("reads and upgrades a legacy entry on the next write", () =>
    withStore(({ store, fs, path, home }) =>
      Effect.gen(function* () {
        publish("someone/program", { manifest: manifest({ sockets: ["old-*"] }), code: CODE });
        yield* store.install(github("someone/program"), "my-plugin", {
          backend: false,
          mcp: false,
          sockets: ["old-*"],
        });
        yield* fs.writeFileString(
          home.pluginsLock,
          JSON.stringify({
            version: 1,
            plugins: {
              "my-plugin": {
                source: github("someone/program"),
                version: "1.0.0",
                sha256: sha256(CODE),
              },
            },
          }),
        );
        expect((yield* store.list)[0]?.error).toBeUndefined();
        const folder = path.join(home.root, "local");
        yield* fs.makeDirectory(folder);
        yield* fs.writeFileString(
          path.join(folder, "manifest.json"),
          manifest({ id: "local", backend: "backend.cjs", mcp: "mcp.js", files: ["native.node"] }),
        );
        yield* fs.writeFileString(path.join(folder, "plugin.js"), CODE);
        yield* store.link(folder);
        const entries = JSON.parse(yield* fs.readFileString(home.pluginsLock)).plugins;
        expect(entries["my-plugin"].files).toEqual({ "plugin.js": sha256(CODE) });
        expect(entries["my-plugin"].approved).toEqual({
          backend: false,
          mcp: false,
          sockets: ["old-*"],
        });
        expect(entries.local).toMatchObject({
          backend: "backend.cjs",
          mcp: "mcp.js",
          approved: { backend: true, mcp: true, sockets: [] },
        });
        expect(entries.local.files).toBeUndefined();
      }),
    ));

  it.each([
    "../bad.js",
    "a/b.js",
    "a\\b.js",
    "manifest.json",
    "plugin.js",
    "t3mode.json",
    ".hidden",
    "x".repeat(101),
    "native.node.",
  ])("refuses extra file name %s", (name) =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        publish("someone/program", { manifest: manifest({ files: [name] }), code: CODE });
        expect(yield* failure(store.preview("someone/program"))).toContain("invalid");
      }),
    ),
  );

  it.each([{ files: ["A.node", "a.node"] }, { backend: "Backend.js", files: ["backend.js"] }])(
    "refuses extra files whose names differ only by case: %j",
    (fields) =>
      withStore(({ store }) =>
        Effect.gen(function* () {
          publish("someone/program", { manifest: manifest(fields), code: CODE });
          expect(yield* failure(store.preview("someone/program"))).toContain(
            "differ by more than case",
          );
        }),
      ),
  );

  it("detects access growth and wildcard coverage", () => {
    const none = declaredAccess({});
    expect(accessGrew(none, none)).toBe(false);
    expect(accessGrew(none, declaredAccess({ backend: "b.js" }))).toBe(true);
    expect(accessGrew(none, declaredAccess({ mcp: "m.js" }))).toBe(true);
    expect(
      accessGrew({ ...none, sockets: ["foo-*"] }, { ...none, sockets: ["foo-bar", "foo-narrow*"] }),
    ).toBe(false);
    expect(accessGrew({ ...none, sockets: ["foo-bar"] }, { ...none, sockets: ["foo-*"] })).toBe(
      true,
    );
    expect(accessGrew({ ...none, sockets: ["foo-*"] }, { ...none, sockets: ["other"] })).toBe(true);
  });
});
