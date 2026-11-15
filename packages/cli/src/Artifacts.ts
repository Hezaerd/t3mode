// The built bundles this repo produces (`pnpm build`), and copying them into a t3mode home.
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { HomeLayout } from "@t3mode/shared/Layout";

import { CliFailure } from "./Errors.ts";

export const repoRoot = Effect.gen(function* () {
  const path = yield* Path.Path;
  return path.resolve(import.meta.dirname, "..", "..", "..");
});

const locate = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = yield* repoRoot;
  const at = (...parts: ReadonlyArray<string>) => path.join(root, "packages", ...parts);
  return {
    shim: at("shim", "dist", "index.cjs"),
    home: [
      { from: at("main", "dist", "main.cjs"), name: "main.cjs" },
      { from: at("main", "dist", "main.cjs.map"), name: "main.cjs.map", optional: true },
      { from: at("preload", "dist", "preload.cjs"), name: "preload.cjs" },
      { from: at("runtime", "dist", "renderer.iife.js"), name: "renderer.js" },
      // Used by the update helper to put the shim back after a T3 Code update.
      { from: at("cli", "dist", "repair.cjs"), name: "repair.cjs" },
      { from: at("shim", "dist", "index.cjs"), name: "shim.cjs" },
      { from: at("main", "assets", "update-helper.ps1"), name: "update-helper.ps1" },
    ],
  };
});

const requireBuilt = Effect.fn("Artifacts.requireBuilt")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false)))) {
    return yield* new CliFailure({ message: `${file} is missing. Run pnpm build first.` });
  }
});

/** Path of the built shim entry. */
export const shimEntry = Effect.gen(function* () {
  const { shim } = yield* locate;
  yield* requireBuilt(shim);
  return shim;
});

/** Copies the loader, preload, renderer and update helper files into `home.dist`. */
export const deploy = Effect.fn("Artifacts.deploy")(
  function* (home: HomeLayout) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const artifacts = yield* locate;
    yield* fs.makeDirectory(home.dist, { recursive: true });
    for (const file of artifacts.home) {
      if (file.optional && !(yield* fs.exists(file.from))) continue;
      yield* requireBuilt(file.from);
      yield* fs.copyFile(file.from, path.join(home.dist, file.name));
    }
  },
  Effect.mapError((error) =>
    error._tag === "CliFailure"
      ? error
      : new CliFailure({ message: "Deploy failed.", cause: error }),
  ),
);
