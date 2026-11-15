// Reading and writing asar archives through @electron/asar.
import * as Asar from "@electron/asar";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { MARKER_FILE, type Marker } from "@t3mode/shared/Layout";

import { CliFailure } from "./Errors.ts";

/** Markers left by other T3 Code mods. Stacking shims would break both. */
const FOREIGN_MARKERS: ReadonlyArray<{ readonly file: string; readonly name: string }> = [
  { file: "t3mod.json", name: "t3mod" },
];

const decodePackageJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const decodeMarker = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ name: Schema.Literal("t3mode"), shimVersion: Schema.Int })),
);

export type ArchiveKind =
  | { readonly kind: "t3mode"; readonly marker: Marker }
  | { readonly kind: "foreign"; readonly name: string }
  | { readonly kind: "original"; readonly pkg: Readonly<Record<string, unknown>> };

export class AsarArchive extends Context.Service<
  AsarArchive,
  {
    readonly readRootFile: (
      archive: string,
      file: string,
    ) => Effect.Effect<string | undefined, CliFailure>;
    readonly inspect: (archive: string) => Effect.Effect<ArchiveKind, CliFailure>;
    readonly pack: (sourceDir: string, archive: string) => Effect.Effect<void, CliFailure>;
  }
>()("@t3mode/cli/Asar/AsarArchive") {}

const readRootFile = (archive: string, file: string) =>
  Effect.try({
    try: () => {
      // @electron/asar caches headers by path; the archive at this path may have been replaced.
      Asar.uncache(archive);
      const listing = Asar.listPackage(archive, { isPack: false });
      const wanted = new Set([`/${file}`, `\\${file}`]);
      return listing.some((entry) => wanted.has(entry))
        ? Asar.extractFile(archive, file).toString("utf8")
        : undefined;
    },
    catch: (cause) => new CliFailure({ message: `Could not read ${archive}.`, cause }),
  });

const inspect = Effect.fn("AsarArchive.inspect")(function* (archive: string) {
  const marker = yield* readRootFile(archive, MARKER_FILE);
  if (marker !== undefined) {
    const decoded = yield* decodeMarker(marker).pipe(
      Effect.mapError(
        (cause) => new CliFailure({ message: `Unreadable ${MARKER_FILE} in ${archive}.`, cause }),
      ),
    );
    return { kind: "t3mode", marker: decoded } satisfies ArchiveKind;
  }
  for (const foreign of FOREIGN_MARKERS) {
    if ((yield* readRootFile(archive, foreign.file)) !== undefined) {
      return { kind: "foreign", name: foreign.name } satisfies ArchiveKind;
    }
  }
  const text = yield* readRootFile(archive, "package.json");
  if (text === undefined) return { kind: "foreign", name: "unknown" } satisfies ArchiveKind;
  const pkg = yield* decodePackageJson(text).pipe(
    Effect.mapError(
      (cause) => new CliFailure({ message: `Unreadable package.json in ${archive}.`, cause }),
    ),
  );
  return pkg["name"] === "t3code"
    ? ({ kind: "original", pkg } satisfies ArchiveKind)
    : ({ kind: "foreign", name: String(pkg["name"] ?? "unknown") } satisfies ArchiveKind);
});

const pack = (sourceDir: string, archive: string) =>
  Effect.tryPromise({
    try: () => Asar.createPackage(sourceDir, archive),
    catch: (cause) => new CliFailure({ message: `Could not write ${archive}.`, cause }),
  });

export const layer = Layer.succeed(AsarArchive, AsarArchive.of({ readRootFile, inspect, pack }));
