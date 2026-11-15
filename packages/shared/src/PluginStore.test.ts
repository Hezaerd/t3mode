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
import { type GithubSource, MAX_PLUGIN_CODE_BYTES } from "./Plugins.ts";

/** Release assets by URL path, as GitHub serves them. */
const assets = new Map<string, string | Uint8Array>();
let server: NodeHttp.Server;
let base = "";

beforeAll(async () => {
  server = NodeHttp.createServer((request, response) => {
    const body = assets.get(request.url ?? "");
    if (body === undefined) {
      response.writeHead(404).end("Not Found");
      return;
    }
    response.writeHead(200, { "content-type": "application/octet-stream" }).end(body);
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

/** Publishes a release: the latest one, or the one at `tag`. */
const publish = (
  repo: string,
  files: { readonly manifest: string; readonly code?: string | Uint8Array },
  tag?: string,
) => {
  const release = tag === undefined ? "releases/latest/download" : `releases/download/${tag}`;
  assets.set(`/${repo}/${release}/manifest.json`, files.manifest);
  if (files.code !== undefined) assets.set(`/${repo}/${release}/plugin.js`, files.code);
};

const github = (repo: string, tag?: string): GithubSource => {
  const [owner = "", name = ""] = repo.split("/");
  return { kind: "github", owner, repo: name, ...(tag === undefined ? {} : { tag }) };
};

const sha256 = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

const PlatformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, FetchHttpClient.layer);

/** Runs `body` against a store in a fresh temp home. */
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
  it("previews a release without installing it", () =>
    withStore(({ store, fs, home }) =>
      Effect.gen(function* () {
        publish("someone/my-plugin", { manifest: manifest(), code: CODE });
        const preview = yield* store.preview("https://github.com/someone/my-plugin");
        expect(preview.source).toEqual(github("someone/my-plugin"));
        expect(preview.manifest).toMatchObject({ id: "my-plugin", version: "1.0.0", api: 1 });
        expect(yield* fs.exists(home.pluginsLock)).toBe(false);
        expect(yield* failure(store.preview("not a link"))).toContain("not a GitHub repository");
        expect(yield* failure(store.preview("someone/missing"))).toContain(
          "No manifest.json in the latest release of someone/missing.",
        );
      }),
    ));

  it("installs a release: its files, then the lockfile entry", () =>
    withStore(({ store, fs, path, home }) =>
      Effect.gen(function* () {
        publish("someone/my-plugin", { manifest: manifest(), code: CODE });
        const installed = yield* store.install(github("someone/my-plugin"), "my-plugin");
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
        yield* store.install(github("someone/my-plugin"), "my-plugin");
        const lock = yield* fs.readFileString(home.pluginsLock);
        const listed = yield* store.list;
        yield* store.install(github("someone/my-plugin"), "my-plugin");
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
        const message = yield* failure(store.install(preview.source, preview.manifest.id));
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
        expect(yield* failure(store.install(github("someone/future"), "my-plugin"))).toContain(
          "plugin API 2",
        );
        for (const id of ["My_Plugin", "../escape", ""]) {
          publish("someone/bad-id", { manifest: manifest({ id }), code: CODE });
          expect(yield* failure(store.preview("someone/bad-id"))).toContain(
            "manifest.json in the latest release of someone/bad-id is invalid",
          );
        }
      }),
    ));

  it("refuses code over the size cap without writing anything", () =>
    withStore(({ store, fs, home }) =>
      Effect.gen(function* () {
        const code = new Uint8Array(MAX_PLUGIN_CODE_BYTES + 1).fill(0x20);
        publish("someone/my-plugin", { manifest: manifest(), code });
        expect(yield* failure(store.install(github("someone/my-plugin"), "my-plugin"))).toContain(
          "plugin.js in the latest release of someone/my-plugin is larger than 5 MB",
        );
        expect(yield* fs.exists(home.plugins)).toBe(false);
        expect(yield* fs.exists(home.pluginsLock)).toBe(false);
      }),
    ));

  it("won't load code that changed on disk after the install", () =>
    withStore(({ store, fs, path, home }) =>
      Effect.gen(function* () {
        publish("someone/my-plugin", { manifest: manifest(), code: CODE });
        yield* store.install(github("someone/my-plugin"), "my-plugin");
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
        expect(yield* failure(store.install(github("someone/my-plugin"), "my-plugin"))).toContain(
          "plugins.json is invalid",
        );
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

        const linked = yield* store.link(path.join(folder, "..", "dist"));
        expect(linked.source).toEqual({ kind: "local", path: folder });
        expect(linked.error).toBeUndefined();
        const lock = yield* fs.readFileString(home.pluginsLock);
        yield* store.link(folder);
        expect(yield* fs.readFileString(home.pluginsLock)).toBe(lock);

        // A rebuild is picked up without linking again, and isn't checked against a hash.
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

        yield* store.install(github("someone/my-plugin"), "my-plugin");
        expect(yield* failure(store.link(folder))).toContain(
          '"my-plugin" is already installed (someone/my-plugin)',
        );
        expect(yield* failure(store.preview("other/fork"))).toContain("already installed");
        expect(yield* failure(store.install(github("other/fork"), "my-plugin"))).toContain(
          "already installed",
        );

        yield* store.remove("my-plugin");
        yield* store.link(folder);
        expect(yield* failure(store.install(github("someone/my-plugin"), "my-plugin"))).toContain(
          `already installed (linked from ${folder})`,
        );
      }),
    ));

  it("removes a GitHub plugin with its folder, and a linked one without its folder", () =>
    withStore(({ store, fs, path, home }) =>
      Effect.gen(function* () {
        publish("someone/my-plugin", { manifest: manifest(), code: CODE });
        yield* store.install(github("someone/my-plugin"), "my-plugin");
        expect(yield* store.remove("my-plugin")).toBe(true);
        expect(yield* store.list).toEqual([]);
        expect(yield* fs.exists(path.join(home.plugins, "my-plugin"))).toBe(false);
        expect(yield* store.remove("my-plugin")).toBe(false);

        const folder = path.join(home.root, "dev");
        yield* fs.makeDirectory(folder, { recursive: true });
        yield* fs.writeFileString(path.join(folder, "manifest.json"), manifest());
        yield* fs.writeFileString(path.join(folder, "plugin.js"), CODE);
        yield* store.link(folder);
        expect(yield* store.remove("my-plugin")).toBe(true);
        expect(yield* fs.exists(path.join(folder, "plugin.js"))).toBe(true);
      }),
    ));

  it("finds newer releases of unpinned plugins, and updates them", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        publish("someone/my-plugin", { manifest: manifest(), code: CODE });
        publish(
          "someone/pinned",
          { manifest: manifest({ id: "pinned", name: "Pinned" }), code: CODE },
          "v1.0.0",
        );
        yield* store.install(github("someone/my-plugin"), "my-plugin");
        yield* store.install(github("someone/pinned", "v1.0.0"), "pinned");
        expect(yield* store.checkUpdates).toEqual({ updates: {}, failures: {} });

        const newer = `${CODE}// 1.1.0\n`;
        publish("someone/my-plugin", { manifest: manifest({ version: "1.1.0" }), code: newer });
        publish("someone/pinned", { manifest: manifest({ id: "pinned", version: "2.0.0" }) });
        expect(yield* store.checkUpdates).toEqual({
          updates: { "my-plugin": "1.1.0" },
          failures: {},
        });

        const updated = yield* store.update("my-plugin");
        expect(updated).toMatchObject({ version: "1.1.0", sha256: sha256(newer) });
        expect(yield* store.checkUpdates).toEqual({ updates: {}, failures: {} });
        expect(yield* failure(store.update("pinned"))).toContain("pinned to v1.0.0");
      }),
    ));
});
