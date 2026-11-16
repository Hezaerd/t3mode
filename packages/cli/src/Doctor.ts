import * as Asar from "@electron/asar";
import { FuseState, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { Resources, T3_UPDATER_OFF_ENV } from "@t3mode/shared/Layout";
import { SHORTCUT_COMMAND } from "@t3mode/shared/Shortcut";
import { T3_HOOKS } from "@t3mode/shared/T3Hooks";
import { parseAppUpdateConfig } from "@t3mode/shared/UpdateFeed";

import { AsarArchive } from "./Asar.ts";
import { CliFailure } from "./Errors.ts";
import type { Target } from "./Target.ts";

export type Piece<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly reason: string };
export interface Original {
  readonly path: string;
  readonly pkg: Readonly<Record<string, unknown>>;
  readonly files: ReadonlyArray<string>;
}
export interface T3Facts {
  readonly exe: string;
  readonly fuses: Piece<Readonly<Partial<Record<FuseV1Options, FuseState>>>>;
  readonly original: Piece<Original>;
  readonly desktop: Piece<string>;
  readonly update: Piece<string>;
  readonly client: Piece<string>;
  readonly server: Piece<string>;
}
export type Outcome =
  | { readonly ok: true; readonly detail: string }
  | { readonly ok: false; readonly detail: string };
export interface Check {
  readonly id: string;
  readonly fact: string;
  readonly why: string;
  readonly run: (facts: T3Facts) => Outcome;
}

const outcome = (ok: boolean, detail: string): Outcome =>
  ok ? { ok: true, detail } : { ok: false, detail };
const fromPiece = <A>(piece: Piece<A>, test: (value: A) => Outcome): Outcome =>
  piece.ok ? test(piece.value) : { ok: false, detail: piece.reason };

export const hasToken = (text: string, token: string): boolean => {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("[\"'`\\[=]" + escaped + "(?=[\"'`\\]=]|\\$\\{)").test(text);
};

const FUSE_STATE_NAMES: Readonly<Partial<Record<FuseState, string>>> = {
  [FuseState.DISABLE]: "off",
  [FuseState.ENABLE]: "on",
  [FuseState.REMOVED]: "removed",
};

const fuseCheck = (id: string, option: FuseV1Options, expected: FuseState, why: string): Check => ({
  id,
  fact: `${FuseV1Options[option]} ${expected === FuseState.ENABLE ? "on" : "off"}`,
  why,
  run: (facts) =>
    fromPiece(facts.fuses, (wire) =>
      outcome(
        wire[option] === expected,
        `${wire[option] === undefined ? "missing" : (FUSE_STATE_NAMES[wire[option]] ?? String(wire[option]))} in ${facts.exe}`,
      ),
    ),
});

export const checks: ReadonlyArray<Check> = [
  fuseCheck(
    "integrity",
    FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
    FuseState.DISABLE,
    "If enabled, T3 Code refuses the swapped app.asar and t3mode stops working.",
  ),
  fuseCheck(
    "asar-only",
    FuseV1Options.OnlyLoadAppFromAsar,
    FuseState.DISABLE,
    "t3mode depends on loading code outside app.asar.",
  ),
  fuseCheck(
    "run-as-node",
    FuseV1Options.RunAsNode,
    FuseState.ENABLE,
    "The update repair helper runs under T3 Code's executable.",
  ),
  {
    id: "original",
    fact: "Original archive has a package.json main file",
    why: "The shim boots the original package.json main.",
    run: (facts) =>
      fromPiece(facts.original, ({ path, pkg, files }) =>
        outcome(
          typeof pkg["main"] === "string" &&
            files.includes(pkg["main"].replaceAll("\\", "/").replace(/^\.\//, "")),
          `${path}, main=${String(pkg["main"])}`,
        ),
      ),
  },
  {
    id: "updater-off",
    fact: `Desktop reads ${T3_UPDATER_OFF_ENV}`,
    why: "t3mode must disable T3 Code's updater before taking over updates.",
    run: (facts) =>
      fromPiece(facts.desktop, (text) =>
        outcome(
          hasToken(text, T3_UPDATER_OFF_ENV) || text.includes(`.${T3_UPDATER_OFF_ENV}`),
          "not found",
        ),
      ),
  },
  {
    id: "bridge",
    fact: "Desktop has desktopBridge",
    why: "The runtime reads T3 Code's preload bridge.",
    run: (facts) =>
      fromPiece(facts.desktop, (text) => outcome(hasToken(text, "desktopBridge"), "not found")),
  },
  {
    id: "update-feed",
    fact: "app-update.yml names a GitHub feed and publisher",
    why: "The updater needs the release feed and trusted installer publisher.",
    run: (facts) =>
      fromPiece(facts.update, (text) => {
        const config = parseAppUpdateConfig(text);
        return outcome(
          config !== undefined && config.publisherNames.some((name) => name.trim() !== ""),
          config
            ? `${config.owner}/${config.repo}, publishers=${config.publisherNames.join(", ")}`
            : "Invalid GitHub update feed",
        );
      }),
  },
  {
    id: "script-command",
    fact: `Server accepts ${SHORTCUT_COMMAND.replace("t3-mode-plugins", "<id>")}`,
    why: "t3mode registers its shortcut as a project script command.",
    run: (facts) =>
      fromPiece(facts.server, (text) =>
        outcome(/isScriptRunCommand\(\s*`script\.\$\{[^}]+\}\.run`\s*\)/.test(text), "not found"),
      ),
  },
  ...Object.entries(T3_HOOKS).map(([id, hook]): Check => ({
    id: `dom-${id}`,
    fact: `Client DOM hook ${hook.attribute}${"value" in hook ? ` ${hook.value}` : ""}`,
    why: "The runtime uses this hook in T3 Code's settings UI.",
    run: (facts) =>
      fromPiece(facts.client, (text) =>
        outcome(
          hasToken(text, hook.attribute) && (!("value" in hook) || hasToken(text, hook.value)),
          "not found",
        ),
      ),
  })),
];

const capture = <A, E, R>(effect: Effect.Effect<A, E, R>, reason: string) =>
  effect.pipe(
    Effect.map((value): Piece<A> => ({ ok: true, value })),
    Effect.catch((cause) =>
      Effect.succeed<Piece<A>>({ ok: false, reason: `${reason}: ${String(cause)}` }),
    ),
  );

export const gather = Effect.fn("Doctor.gather")(function* (target: Target) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const archives = yield* AsarArchive;
  const fuses = yield* capture(
    Effect.tryPromise({
      try: () => getCurrentFuseWire(target.exe),
      catch: (cause) => new CliFailure({ message: String(cause), cause }),
    }),
    "Could not read Electron fuses",
  );
  const original = yield* capture(
    Effect.gen(function* () {
      const active = path.join(target.resourcesDir, Resources.shimAsar);
      const inspected = yield* archives.inspect(active);
      const archive =
        inspected.kind === "t3mode"
          ? path.join(target.resourcesDir, Resources.originalAsar)
          : active;
      const kind = inspected.kind === "t3mode" ? yield* archives.inspect(archive) : inspected;
      if (kind.kind !== "original")
        return yield* new CliFailure({ message: `No original T3 Code archive at ${archive}.` });
      const files = yield* Effect.try({
        try: () =>
          Asar.listPackage(archive, { isPack: false })
            .map((file) => file.replaceAll("\\", "/").replace(/^\//, ""))
            .filter((file) => !("files" in Asar.statFile(archive, file.split("/").join(path.sep)))),
        catch: (cause) => new CliFailure({ message: `Could not list ${archive}.`, cause }),
      });
      return { path: archive, pkg: kind.pkg, files };
    }),
    "Could not read original archive",
  );
  const bundle = (
    archive: string,
    files: ReadonlyArray<string>,
    matches: (file: string) => boolean,
  ) =>
    capture(
      Effect.try({
        try: () => {
          const selected = files.filter(matches);
          if (selected.length === 0) throw new Error("No matching JavaScript files");
          return selected
            .map((file) =>
              Asar.extractFile(archive, file.split("/").join(path.sep)).toString("utf8"),
            )
            .join("\n");
        },
        catch: (cause) => new CliFailure({ message: String(cause), cause }),
      }),
      `Could not read JavaScript in ${archive}`,
    );
  const desktop: Piece<string> = original.ok
    ? yield* bundle(original.value.path, original.value.files, (file) =>
        /^apps\/desktop\/dist-electron\/[^/]+\.cjs$/.test(file),
      )
    : original;
  const serverArchive = path.join(target.resourcesDir, "server.asar");
  const serverFiles = yield* capture(
    Effect.try({
      try: () =>
        Asar.listPackage(serverArchive, { isPack: false }).map((file) =>
          file.replaceAll("\\", "/").replace(/^\//, ""),
        ),
      catch: (cause) => new CliFailure({ message: String(cause), cause }),
    }),
    "Could not list server.asar",
  );
  const client: Piece<string> = serverFiles.ok
    ? yield* bundle(serverArchive, serverFiles.value, (file) =>
        /^apps\/server\/dist\/client\/.+\.js$/.test(file),
      )
    : serverFiles;
  const server: Piece<string> = serverFiles.ok
    ? yield* bundle(serverArchive, serverFiles.value, (file) =>
        /^apps\/server\/dist\/[^/]+\.mjs$/.test(file),
      )
    : serverFiles;
  const update = yield* capture(
    fs.readFileString(path.join(target.resourcesDir, "app-update.yml")),
    "Could not read app-update.yml",
  );
  return { exe: target.exe, fuses, original, desktop, update, client, server } satisfies T3Facts;
});

export const run = Effect.fn("Doctor.run")(function* (target: Target) {
  const facts = yield* gather(target);
  let failed = 0;
  for (const check of checks) {
    const result = check.run(facts);
    if (!result.ok) failed++;
    yield* Console.log(
      result.ok
        ? `ok   ${check.fact}`
        : `FAIL ${check.fact}: ${result.detail}
     Why: ${check.why}`,
    );
  }
  yield* Console.log(`${checks.length - failed}/${checks.length} checks passed; ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
});
