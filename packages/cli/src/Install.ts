// Swapping T3 Code's app.asar for the t3mode shim, and back.
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { MARKER_FILE, Resources, makeMarker } from "@t3mode/shared/Layout";

import { AsarArchive } from "./Asar.ts";
import { CliFailure } from "./Errors.ts";
import type { Target } from "./Target.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const resourcePaths = (path: Path.Path, target: Target) => ({
  shimAsar: path.join(target.resourcesDir, Resources.shimAsar),
  originalAsar: path.join(target.resourcesDir, Resources.originalAsar),
  unpacked: path.join(target.resourcesDir, Resources.unpacked),
  originalUnpacked: path.join(target.resourcesDir, Resources.originalUnpacked),
});

const fsFailure = (message: string) => (cause: unknown) => new CliFailure({ message, cause });

export type ApplyResult = "installed" | "reapplied-after-update" | "refreshed";

/**
 * Makes `app.asar` the current shim, whatever state the install is in:
 * - vanilla T3 Code: move the original aside and add the shim;
 * - T3 Code updated over the shim: drop the stale original, then the same as vanilla;
 * - shim already there: rewrite it, so it matches the original's version and this shim build.
 * The new shim is built before anything is moved, so a failure leaves T3 Code bootable.
 */
export const applyShim = Effect.fn("Install.applyShim")(
  function* (target: Target, shimEntry: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const asar = yield* AsarArchive;
    const paths = resourcePaths(path, target);

    const current = yield* asar.inspect(paths.shimAsar);
    if (current.kind === "foreign") {
      return yield* new CliFailure({
        message: `app.asar belongs to another mod (${current.name}). Uninstall it before installing t3mode.`,
      });
    }
    const hadOriginal = yield* fs
      .exists(paths.originalAsar)
      .pipe(Effect.orElseSucceed(() => false));
    if (current.kind === "t3mode" && !hadOriginal) {
      return yield* new CliFailure({
        message: `The shim is installed but ${Resources.originalAsar} is missing. Reinstall T3 Code, then run install again.`,
      });
    }

    const originalPackageSource = current.kind === "original" ? paths.shimAsar : paths.originalAsar;
    const pkgText = yield* asar.readRootFile(originalPackageSource, "package.json");
    if (pkgText === undefined) {
      return yield* new CliFailure({ message: `No package.json in ${originalPackageSource}.` });
    }
    const pkg = yield* Schema.decodeEffect(
      Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
    )(pkgText).pipe(
      Effect.mapError(fsFailure(`Unreadable package.json in ${originalPackageSource}.`)),
    );

    // Electron reads name and version from the entry archive's package.json, so the shim
    // carries the original's fields with only `main` changed.
    const nextShim = `${paths.shimAsar}.t3mode-next`;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3mode-shim-" });
        yield* fs.copyFile(shimEntry, path.join(dir, "index.js"));
        yield* fs.writeFileString(
          path.join(dir, "package.json"),
          yield* encodeJson({ ...pkg, main: "index.js" }),
        );
        yield* fs.writeFileString(path.join(dir, MARKER_FILE), yield* encodeJson(makeMarker()));
        yield* asar.pack(dir, nextShim);
      }),
    ).pipe(
      Effect.mapError((error) =>
        error._tag === "CliFailure" ? error : fsFailure("Could not build the shim.")(error),
      ),
    );

    if (current.kind === "original") {
      if (hadOriginal) yield* fs.remove(paths.originalAsar, { force: true });
      yield* fs.remove(paths.originalUnpacked, { recursive: true, force: true });
      yield* fs.rename(paths.shimAsar, paths.originalAsar);
      // T3 Code may look up native modules under either name, so the unpacked folder is copied, not moved.
      if (yield* fs.exists(paths.unpacked)) yield* fs.copy(paths.unpacked, paths.originalUnpacked);
    }
    yield* fs.rename(nextShim, paths.shimAsar).pipe(
      Effect.catch((error) =>
        // Put the original back so T3 Code still starts.
        (current.kind === "original"
          ? fs.rename(paths.originalAsar, paths.shimAsar)
          : Effect.void
        ).pipe(Effect.andThen(Effect.fail(fsFailure("Could not put the shim in place.")(error)))),
      ),
    );

    const result: ApplyResult =
      current.kind === "t3mode"
        ? "refreshed"
        : hadOriginal
          ? "reapplied-after-update"
          : "installed";
    return result;
  },
  Effect.mapError((error) =>
    error._tag === "CliFailure" ? error : fsFailure("Install failed.")(error),
  ),
);

export type RemoveResult = "removed" | "not-installed";

export const removeShim = Effect.fn("Install.removeShim")(
  function* (target: Target) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const asar = yield* AsarArchive;
    const paths = resourcePaths(path, target);

    const current = yield* asar.inspect(paths.shimAsar);
    if (current.kind === "foreign") {
      return yield* new CliFailure({
        message: `app.asar belongs to another mod (${current.name}), not t3mode.`,
      });
    }
    if (current.kind === "original") {
      // A T3 Code update replaced the shim. Only leftovers remain.
      yield* fs.remove(paths.originalAsar, { force: true });
      yield* fs.remove(paths.originalUnpacked, { recursive: true, force: true });
      return "not-installed" satisfies RemoveResult;
    }
    if (!(yield* fs.exists(paths.originalAsar))) {
      return yield* new CliFailure({
        message: `${Resources.originalAsar} is missing, so there is nothing to restore. Reinstall T3 Code.`,
      });
    }
    yield* fs.remove(paths.shimAsar);
    yield* fs.rename(paths.originalAsar, paths.shimAsar);
    yield* fs.remove(paths.originalUnpacked, { recursive: true, force: true });
    return "removed" satisfies RemoveResult;
  },
  Effect.mapError((error) =>
    error._tag === "CliFailure" ? error : fsFailure("Uninstall failed.")(error),
  ),
);

export interface InstallStatus {
  readonly archive: "t3mode" | "original" | "foreign";
  readonly shimVersion: number | undefined;
  readonly foreignName: string | undefined;
  readonly t3codeVersion: string | undefined;
}

const versionOf = (pkg: Readonly<Record<string, unknown>>) =>
  typeof pkg["version"] === "string" ? pkg["version"] : undefined;

export const readStatus = Effect.fn("Install.readStatus")(function* (target: Target) {
  const path = yield* Path.Path;
  const asar = yield* AsarArchive;
  const paths = resourcePaths(path, target);
  const current = yield* asar.inspect(paths.shimAsar);
  if (current.kind === "original") {
    return {
      archive: "original",
      shimVersion: undefined,
      foreignName: undefined,
      t3codeVersion: versionOf(current.pkg),
    } satisfies InstallStatus;
  }
  if (current.kind === "foreign") {
    return {
      archive: "foreign",
      shimVersion: undefined,
      foreignName: current.name,
      t3codeVersion: undefined,
    } satisfies InstallStatus;
  }
  const original = yield* asar.inspect(paths.originalAsar).pipe(Effect.option);
  return {
    archive: "t3mode",
    shimVersion: current.marker.shimVersion,
    foreignName: undefined,
    t3codeVersion:
      original._tag === "Some" && original.value.kind === "original"
        ? versionOf(original.value.pkg)
        : undefined,
  } satisfies InstallStatus;
});
