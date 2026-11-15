import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import { describe, expect, it } from "vite-plus/test";

import { homeLayout } from "@t3mode/shared/Layout";

import * as AsarArchive from "./Asar.ts";
import * as Install from "./Install.ts";
import type { Target } from "./Target.ts";

const TestLayer = AsarArchive.layer.pipe(Layer.provideMerge(NodeServices.layer));

const run = <A, E>(
  effect: Effect.Effect<A, E, AsarArchive.AsarArchive | NodeServices.NodeServices | Scope.Scope>,
) => Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(TestLayer)));

/** A fake T3 Code install: resources/app.asar holding a package.json, plus app.asar.unpacked. */
const fakeInstall = (version: string, extraFiles: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const asar = yield* AsarArchive.AsarArchive;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3mode-test-" });
    const resources = path.join(root, "app", "resources");
    yield* fs.makeDirectory(path.join(resources, "app.asar.unpacked"), { recursive: true });
    yield* fs.writeFileString(path.join(resources, "app.asar.unpacked", "native.node"), "native");
    yield* writeOriginal(resources, version, extraFiles);
    const shimEntry = path.join(root, "shim.cjs");
    yield* fs.writeFileString(shimEntry, "// shim");
    const target: Target = {
      installDir: path.join(root, "app"),
      resourcesDir: resources,
      exe: path.join(root, "app", "T3 Code.exe"),
      home: homeLayout(path.join(root, "home")),
    };
    return { target, shimEntry, resources, asar, fs, path };
  });

/** What an NSIS update does: a fresh original app.asar over whatever was there. */
const writeOriginal = (
  resources: string,
  version: string,
  extraFiles: Record<string, string> = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const asar = yield* AsarArchive.AsarArchive;
    const source = yield* fs.makeTempDirectoryScoped({ prefix: "t3mode-original-" });
    yield* fs.writeFileString(
      path.join(source, "package.json"),
      `{"name":"t3code","version":"${version}","main":"boot.cjs"}`,
    );
    for (const [name, text] of Object.entries(extraFiles)) {
      yield* fs.writeFileString(path.join(source, name), text);
    }
    yield* asar.pack(source, path.join(resources, "app.asar"));
  });

describe("Install", () => {
  it("installs, then reports a t3mode shim carrying the original's version", () =>
    run(
      Effect.gen(function* () {
        const { target, shimEntry, resources, asar, fs, path } = yield* fakeInstall("1.0.0");
        expect(yield* Install.applyShim(target, shimEntry)).toBe("installed");

        const shim = yield* asar.inspect(path.join(resources, "app.asar"));
        expect(shim.kind).toBe("t3mode");
        const shimPkg = yield* asar.readRootFile(path.join(resources, "app.asar"), "package.json");
        expect(shimPkg).toContain('"version":"1.0.0"');
        expect(shimPkg).toContain('"main":"index.js"');
        expect(yield* fs.exists(path.join(resources, "_app.asar.unpacked", "native.node"))).toBe(
          true,
        );
        expect(yield* fs.exists(path.join(resources, "app.asar.unpacked", "native.node"))).toBe(
          true,
        );
        expect((yield* Install.readStatus(target)).t3codeVersion).toBe("1.0.0");
      }),
    ));

  it("refreshes an existing shim without touching the original", () =>
    run(
      Effect.gen(function* () {
        const { target, shimEntry } = yield* fakeInstall("1.0.0");
        yield* Install.applyShim(target, shimEntry);
        expect(yield* Install.applyShim(target, shimEntry)).toBe("refreshed");
        expect((yield* Install.readStatus(target)).t3codeVersion).toBe("1.0.0");
      }),
    ));

  it("re-applies after an update replaced the shim, keeping the new version", () =>
    run(
      Effect.gen(function* () {
        const { target, shimEntry, resources } = yield* fakeInstall("1.0.0");
        yield* Install.applyShim(target, shimEntry);
        yield* writeOriginal(resources, "2.0.0");
        expect((yield* Install.readStatus(target)).archive).toBe("original");

        expect(yield* Install.applyShim(target, shimEntry)).toBe("reapplied-after-update");
        const status = yield* Install.readStatus(target);
        expect(status.archive).toBe("t3mode");
        expect(status.t3codeVersion).toBe("2.0.0");
      }),
    ));

  it("uninstalls back to the original archive", () =>
    run(
      Effect.gen(function* () {
        const { target, shimEntry, resources, fs, path } = yield* fakeInstall("1.0.0");
        yield* Install.applyShim(target, shimEntry);
        expect(yield* Install.removeShim(target)).toBe("removed");
        expect((yield* Install.readStatus(target)).archive).toBe("original");
        expect(yield* fs.exists(path.join(resources, "_app.asar"))).toBe(false);
        expect(yield* fs.exists(path.join(resources, "_app.asar.unpacked"))).toBe(false);
        expect(yield* Install.removeShim(target)).toBe("not-installed");
      }),
    ));

  it("refuses to stack on another mod's shim", () =>
    run(
      Effect.gen(function* () {
        const { target, shimEntry } = yield* fakeInstall("1.0.0", { "t3mod.json": "{}" });
        const error = yield* Effect.flip(Install.applyShim(target, shimEntry));
        expect(error.message).toContain("another mod (t3mod)");
      }),
    ));
});
