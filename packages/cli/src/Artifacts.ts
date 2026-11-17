// The bundles `install` and `deploy` copy into a t3mode home, and where to find them.
// From source (`pnpm t3mode` in this repo), they are the packages' build output (`pnpm build`).
// In the published CLI (dist/t3mode.cjs), they ship next to it, in dist/bundles.
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { HomeLayout } from "@t3mode/shared/Layout";

import { CliFailure } from "./Errors.ts";

declare const __T3MODE_PACKAGED__: boolean | undefined;

/** True in the published CLI bundle, where the build defines `__T3MODE_PACKAGED__`. */
export const packaged = typeof __T3MODE_PACKAGED__ !== "undefined";

/** The command that runs this CLI, for messages that tell the user what to run next. */
export const command = packaged ? "t3mode" : "pnpm t3mode";

export const repoRoot = Effect.gen(function* () {
  const path = yield* Path.Path;
  if (packaged) {
    return yield* new CliFailure({
      message: "This command only runs from a clone of the t3mode repository.",
    });
  }
  return path.resolve(import.meta.dirname, "..", "..", "..");
});

interface Bundle {
  /** The package that builds it. */
  readonly pkg: string;
  /** Its path inside that package. */
  readonly file: string;
  /** Its name in the t3mode home. */
  readonly name: string;
  readonly optional?: boolean;
}

const SHIM: Bundle = { pkg: "shim", file: "dist/index.cjs", name: "shim.cjs" };

const HOME_BUNDLES: ReadonlyArray<Bundle> = [
  { pkg: "main", file: "dist/main.cjs", name: "main.cjs" },
  { pkg: "main", file: "dist/main.cjs.map", name: "main.cjs.map", optional: true },
  { pkg: "preload", file: "dist/preload.cjs", name: "preload.cjs" },
  { pkg: "runtime", file: "dist/renderer.iife.js", name: "renderer.js" },
  // Used by the update helper to put the shim back after a T3 Code update.
  { pkg: "cli", file: "dist/repair.cjs", name: "repair.cjs" },
  SHIM,
  { pkg: "main", file: "assets/update-helper.ps1", name: "update-helper.ps1" },
  { pkg: "main", file: "assets/backend-host.cjs", name: "backend-host.cjs" },
];

/** Where a bundle is. The published CLI keeps its own bundles next to it, the rest in bundles/. */
const locate = Effect.fn("Artifacts.locate")(function* (bundle: Bundle) {
  const path = yield* Path.Path;
  const file = path.basename(bundle.file);
  if (packaged) {
    return bundle.pkg === "cli"
      ? path.join(import.meta.dirname, file)
      : path.join(import.meta.dirname, "bundles", file);
  }
  return path.join(yield* repoRoot, "packages", bundle.pkg, bundle.file);
});

const requireBuilt = Effect.fn("Artifacts.requireBuilt")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false)))) {
    return yield* new CliFailure({
      message: packaged
        ? `${file} is missing. Reinstall the t3mode CLI.`
        : `${file} is missing. Run pnpm build first.`,
    });
  }
});

/** Path of the built shim entry. */
export const shimEntry = Effect.gen(function* () {
  const shim = yield* locate(SHIM);
  yield* requireBuilt(shim);
  return shim;
});

/** Copies the loader, preload, renderer and update helper files into `home.dist`. */
export const deploy = Effect.fn("Artifacts.deploy")(
  function* (home: HomeLayout) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(home.dist, { recursive: true });
    for (const bundle of HOME_BUNDLES) {
      const from = yield* locate(bundle);
      if (bundle.optional && !(yield* fs.exists(from))) continue;
      yield* requireBuilt(from);
      yield* fs.copyFile(from, path.join(home.dist, bundle.name));
    }
  },
  Effect.mapError((error) =>
    error._tag === "CliFailure"
      ? error
      : new CliFailure({ message: "Deploy failed.", cause: error }),
  ),
);
