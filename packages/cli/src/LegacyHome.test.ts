import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import { describe, expect, it } from "vite-plus/test";

import * as LegacyHome from "./LegacyHome.ts";

const run = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices | Scope.Scope>) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

const folders = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const temp = yield* fs.makeTempDirectoryScoped({ prefix: "t3mode-home-test-" });
  return {
    fs,
    path,
    legacy: path.join(temp, "appdata", "t3mode"),
    root: path.join(temp, "t3home", "t3mode"),
  };
});

describe("LegacyHome.move", () => {
  it("moves the legacy contents and creates the destination parent", () =>
    run(
      Effect.gen(function* () {
        const { fs, path, legacy, root } = yield* folders;
        yield* fs.makeDirectory(path.join(legacy, "dist"), { recursive: true });
        yield* fs.writeFileString(path.join(legacy, "dist", "main.cjs"), "bundle");
        yield* fs.writeFileString(path.join(legacy, "settings.json"), "settings");

        yield* LegacyHome.move(legacy, root);

        expect(yield* fs.exists(legacy)).toBe(false);
        expect(yield* fs.readFileString(path.join(root, "dist", "main.cjs"))).toBe("bundle");
        expect(yield* fs.readFileString(path.join(root, "settings.json"))).toBe("settings");
      }),
    ));

  it("leaves both folders untouched when the new root already exists", () =>
    run(
      Effect.gen(function* () {
        const { fs, path, legacy, root } = yield* folders;
        yield* fs.makeDirectory(legacy, { recursive: true });
        yield* fs.makeDirectory(root, { recursive: true });
        yield* fs.writeFileString(path.join(legacy, "settings.json"), "old");
        yield* fs.writeFileString(path.join(root, "settings.json"), "new");

        yield* LegacyHome.move(legacy, root);

        expect(yield* fs.readFileString(path.join(legacy, "settings.json"))).toBe("old");
        expect(yield* fs.readFileString(path.join(root, "settings.json"))).toBe("new");
        expect(yield* fs.readDirectory(legacy)).toEqual(["settings.json"]);
        expect(yield* fs.readDirectory(root)).toEqual(["settings.json"]);
      }),
    ));

  it("does nothing when the legacy folder is missing", () =>
    run(
      Effect.gen(function* () {
        const { fs, legacy, root } = yield* folders;

        yield* LegacyHome.move(legacy, root);

        expect(yield* fs.exists(legacy)).toBe(false);
        expect(yield* fs.exists(root)).toBe(false);
      }),
    ));

  it("converges when run twice", () =>
    run(
      Effect.gen(function* () {
        const { fs, path, legacy, root } = yield* folders;
        yield* fs.makeDirectory(legacy, { recursive: true });
        yield* fs.writeFileString(path.join(legacy, "settings.json"), "settings");

        yield* LegacyHome.move(legacy, root);
        yield* LegacyHome.move(legacy, root);

        expect(yield* fs.exists(legacy)).toBe(false);
        expect(yield* fs.readDirectory(root)).toEqual(["settings.json"]);
        expect(yield* fs.readFileString(path.join(root, "settings.json"))).toBe("settings");
      }),
    ));

  it("reports a manual move when renaming fails and preserves the legacy contents", () =>
    run(
      Effect.gen(function* () {
        const { fs, path, legacy } = yield* folders;
        yield* fs.makeDirectory(legacy, { recursive: true });
        yield* fs.writeFileString(path.join(legacy, "settings.json"), "settings");
        const root = path.join(legacy, "child");

        const error = yield* Effect.flip(LegacyHome.move(legacy, root));

        expect(error._tag).toBe("CliFailure");
        expect(error.message).toContain(legacy);
        expect(error.message).toContain(root);
        expect(error.message).toContain("Move the folder by hand");
        expect(yield* fs.readFileString(path.join(legacy, "settings.json"))).toBe("settings");
        expect(yield* fs.exists(root)).toBe(false);
      }),
    ));
});
