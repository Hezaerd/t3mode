// plugins.json and the plugin folders in the t3mode home (see "Plugins" in docs/architecture.md).
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/http";

import type { HomeLayout } from "./Layout.ts";
import {
  type Approval,
  accessGrew,
  declaredAccess,
  extraFiles,
  extraFilesCollide,
  isPluginFile,
  isPluginScript,
  MAX_PLUGIN_SCRIPT_BYTES,
  MAX_PLUGIN_ASSET_BYTES,
  MAX_PLUGIN_EXTRA_BYTES,
  MAX_PLUGIN_EXTRA_FILES,
  NO_ACCESS,
  type GithubSource,
  type InstalledPlugin,
  isGithubOwner,
  isGithubRepo,
  isGithubTag,
  isPluginId,
  isPluginRoute,
  MAX_REGISTRY_PLUGINS,
  type PluginOffer,
  lockEntry,
  type LockEntry,
  type Lockfile,
  type Manifest,
  MAX_PLUGIN_CODE_BYTES,
  MAX_PLUGIN_MANIFEST_BYTES,
  type PageScript,
  parseGithubSource,
  PLUGIN_API_VERSION,
  PLUGIN_FILES,
  PLUGIN_ID_PATTERN,
  type PluginPreview,
  type RemoveResult,
  pluginScriptName,
  releaseAssetName,
  releaseAssetUrl,
  sameRepoOrFolder,
  sourceLabel,
  wrapPluginCode,
} from "./Plugins.ts";
import { compareVersions, parseVersion } from "./Semver.ts";

// Struct decoding drops keys it doesn't name, so an `approved.sockets` from an older lockfile
// and a `sockets` in an older manifest still decode.
export const AccessSchema = Schema.Struct({
  backend: Schema.Boolean,
  mcp: Schema.Boolean,
});

export class PluginError extends Schema.TaggedError<PluginError>()("PluginError", {
  message: Schema.String,
  approval: Schema.optionalKey(AccessSchema),
  cause: Schema.optional(Schema.Defect()),
}) {}

export const PluginIdSchema = Schema.String.check(
  Schema.isPattern(PLUGIN_ID_PATTERN, {
    expected: "an id of lowercase letters, digits and hyphens, up to 64 characters",
  }),
);

const matching = (test: (value: string) => boolean, expected: string) =>
  Schema.String.check(Schema.makeFilter((value: string) => test(value), { expected }));

export const GithubSourceSchema = Schema.Struct({
  kind: Schema.Literal("github"),
  owner: matching(isGithubOwner, "a GitHub owner"),
  repo: matching(isGithubRepo, "a GitHub repository name"),
  tag: Schema.optionalKey(matching(isGithubTag, "a release tag")),
  plugin: Schema.optionalKey(PluginIdSchema),
});

const PluginSourceSchema = Schema.Union([
  GithubSourceSchema,
  Schema.Struct({ kind: Schema.Literal("local"), path: Schema.NonEmptyString }),
]);

export const ManifestSchema = Schema.Struct({
  id: PluginIdSchema,
  name: Schema.NonEmptyString,
  version: matching((value) => parseVersion(value) !== undefined, "a semantic version"),
  description: Schema.String,
  author: Schema.optionalKey(Schema.String),
  api: Schema.Number,
  backend: Schema.optionalKey(matching(isPluginScript, "a JavaScript file name")),
  mcp: Schema.optionalKey(matching(isPluginScript, "a JavaScript file name")),
  files: Schema.optionalKey(Schema.Array(matching(isPluginFile, "an extra file name"))),
}).check(
  Schema.makeFilter((manifest) => extraFiles(manifest).length <= MAX_PLUGIN_EXTRA_FILES, {
    expected: "at most 20 extra files",
  }),
  Schema.makeFilter((manifest) => !extraFilesCollide(manifest), {
    expected: "extra file names that differ by more than case",
  }),
);

export const RegistrySchema = Schema.Struct({
  plugins: Schema.Record(
    Schema.String,
    matching(isPluginRoute, "a relative POSIX plugin route"),
  ).check(
    Schema.makeFilter((plugins) => Object.keys(plugins).every(isPluginId), {
      expected: "plugin ids as keys",
    }),
    Schema.makeFilter(
      (plugins) =>
        Object.keys(plugins).length > 0 && Object.keys(plugins).length <= MAX_REGISTRY_PLUGINS,
      { expected: `1 to ${MAX_REGISTRY_PLUGINS} plugins` },
    ),
  ),
});

class DownloadNotFound extends Schema.TaggedError<DownloadNotFound>()("DownloadNotFound", {
  message: Schema.String,
  release: Schema.String,
}) {}

export const LockfileSchema = Schema.Struct({
  version: Schema.Literal(1),
  // A key Schema would drop entries with a bad id silently; this fails the whole file instead.
  plugins: Schema.Record(
    Schema.String,
    Schema.Struct({
      source: PluginSourceSchema,
      version: Schema.String,
      sha256: Schema.optionalKey(Schema.String),
      files: Schema.optionalKey(
        Schema.Record(Schema.String, Schema.String).check(
          Schema.makeFilter(
            (files) =>
              Object.keys(files).every((name) => name === PLUGIN_FILES.code || isPluginFile(name)),
            { expected: "pinned file names" },
          ),
        ),
      ),
      backend: Schema.optionalKey(matching(isPluginScript, "a JavaScript file name")),
      mcp: Schema.optionalKey(matching(isPluginScript, "a JavaScript file name")),
      approved: Schema.optionalKey(AccessSchema),
    }),
  ).check(
    Schema.makeFilter((plugins) => Object.keys(plugins).every(isPluginId), {
      expected: "plugin ids as keys",
    }),
  ),
});

const RegistryJson = Schema.fromJsonString(RegistrySchema);
const ManifestJson = Schema.fromJsonString(ManifestSchema);
const LockfileJson = Schema.fromJsonString(LockfileSchema);

const EMPTY_LOCK: Lockfile = { version: 1, plugins: {} };

export interface UpdateCheck {
  readonly updates: Readonly<Record<string, string>>;
  readonly failures: Readonly<Record<string, string>>;
}

/** An installed plugin's programs: what main runs or registers for it, when it is enabled. */
export interface PluginProgram {
  readonly id: string;
  /** `<home>/plugins/<id>`, or a linked plugin's own folder. */
  readonly folder: string;
  readonly linked: boolean;
  /** The tool server script's absolute path. */
  readonly mcp?: string;
  /** The backend script's absolute path. */
  readonly backend?: string;
  /**
   * Changes when the programs' files change: the pinned hashes of a GitHub plugin, or the
   * backend script's modification time for a linked one, so a rebuild restarts it.
   */
  readonly version: string;
}

export interface PluginStoreOptions {
  readonly layout: HomeLayout;
  readonly githubBase: string;
  /**
   * Stops a plugin's processes, so its files can be replaced or deleted (Windows keeps a loaded
   * `.node` file locked). Called before an update writes and before a remove deletes, for plugins
   * with a backend and GitHub plugins with a tool server; `backend` says whether the installed
   * version has one.
   * It returns what to run once the files are written or deleted, whatever the outcome. Defaults
   * to doing nothing.
   */
  readonly stopProcesses?: (
    id: string,
    folder: string,
    backend: boolean,
  ) => Effect.Effect<Effect.Effect<void>, PluginError>;
}

export class PluginStore extends Context.Service<
  PluginStore,
  {
    readonly list: Effect.Effect<ReadonlyArray<InstalledPlugin>>;
    readonly script: (id: string) => Effect.Effect<PageScript | undefined>;
    readonly scripts: Effect.Effect<ReadonlyArray<PageScript>>;
    readonly preview: (input: string) => Effect.Effect<PluginPreview, PluginError>;
    readonly install: (
      source: GithubSource,
      expectedId: string,
      approved: Approval,
    ) => Effect.Effect<InstalledPlugin, PluginError>;
    readonly update: (
      id: string,
      approved?: Approval,
    ) => Effect.Effect<InstalledPlugin, PluginError>;
    readonly remove: (id: string) => Effect.Effect<RemoveResult, PluginError>;
    readonly link: (path: string) => Effect.Effect<ReadonlyArray<InstalledPlugin>, PluginError>;
    readonly checkUpdates: Effect.Effect<UpdateCheck, PluginError>;
    /**
     * The tool servers and backends of installed plugins that load: GitHub plugins whose pinned
     * files all match, and linked plugins whose scripts exist.
     */
    readonly programs: Effect.Effect<ReadonlyArray<PluginProgram>>;
  }
>()("@t3mode/shared/PluginStore") {}

const sha256Hex = (bytes: Uint8Array) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  );

const concat = (chunks: ReadonlyArray<Uint8Array>, size: number): Uint8Array => {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

const describeSchemaError = (error: Schema.SchemaError) =>
  error.message.replaceAll(/\s*\n\s*/g, " ");

const checkManifest = (manifest: Manifest, where: string, expectedId?: string) => {
  if (manifest.api !== PLUGIN_API_VERSION) {
    return Effect.fail(
      new PluginError({
        message: `${manifest.name} (${where}) is built for plugin API ${manifest.api}, and this t3mode runs API ${PLUGIN_API_VERSION}.`,
      }),
    );
  }
  if (expectedId !== undefined && manifest.id !== expectedId) {
    return Effect.fail(
      new PluginError({
        message: `${where} now holds "${manifest.id}" instead of "${expectedId}". Nothing was installed.`,
      }),
    );
  }
  return Effect.succeed(manifest);
};

const fail = (message: string) => (cause: unknown) => new PluginError({ message, cause });

const decodeRegistry = (text: string) =>
  Schema.decodeEffect(RegistryJson)(text).pipe(
    Effect.mapError(
      (cause) =>
        new PluginError({ message: `Invalid t3mode.json: ${describeSchemaError(cause)}`, cause }),
    ),
  );

const failed = (plugin: InstalledPlugin, error: string) => ({
  plugin: { ...plugin, error },
  code: undefined,
});

const checkConflict = (current: Lockfile, id: string, source: LockEntry["source"]) => {
  const existing = lockEntry(current, id);
  return existing && !sameRepoOrFolder(existing.source, source)
    ? Effect.fail(
        new PluginError({
          message: `A plugin with the id "${id}" is already installed (${sourceLabel(existing.source)}). Remove it first.`,
        }),
      )
    : Effect.void;
};

export const make = Effect.fn("PluginStore.make")(function* (options: PluginStoreOptions) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(HttpClientRequest.setHeader("user-agent", "t3mode")),
  );
  const { layout } = options;
  const lock = yield* Semaphore.make(1);
  const decoder = new TextDecoder();

  const writeAtomic = Effect.fn("PluginStore.writeAtomic")(
    function* (file: string, bytes: Uint8Array) {
      const temp = `${file}.tmp`;
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      yield* fs.writeFile(temp, bytes);
      yield* fs
        .rename(temp, file)
        .pipe(Effect.tapError(() => fs.remove(temp, { force: true }).pipe(Effect.ignore)));
    },
    Effect.mapError(fail("t3mode could not write to its plugins folder.")),
  );

  const readLock = Effect.gen(function* () {
    if (!(yield* fs.exists(layout.pluginsLock).pipe(Effect.orElseSucceed(() => false)))) {
      return EMPTY_LOCK;
    }
    const text = yield* fs
      .readFileString(layout.pluginsLock)
      .pipe(Effect.mapError(fail(`Could not read ${layout.pluginsLock}.`)));
    const decoded = yield* Schema.decodeEffect(LockfileJson)(text).pipe(
      Effect.mapError(
        (cause) =>
          new PluginError({
            message: `${layout.pluginsLock} is invalid (${describeSchemaError(cause)}). Fix or delete it.`,
            cause,
          }),
      ),
    );
    const plugins: Record<string, LockEntry> = {};
    for (const [id, entry] of Object.entries(decoded.plugins)) {
      const folder =
        entry.source.kind === "local" ? entry.source.path : path.join(layout.plugins, id);
      const manifest =
        entry.approved === undefined
          ? yield* fs
              .readFileString(path.join(folder, PLUGIN_FILES.manifest))
              .pipe(Effect.flatMap(Schema.decodeEffect(ManifestJson)), Effect.option)
          : Option.none();
      plugins[id] = {
        ...entry,
        ...(entry.files === undefined && entry.sha256 !== undefined
          ? { files: { [PLUGIN_FILES.code]: entry.sha256 } }
          : {}),
        ...(Option.isSome(manifest) ? { approved: declaredAccess(manifest.value) } : {}),
      };
    }
    return { ...decoded, plugins };
  });

  const writeLock = Effect.fn("PluginStore.writeLock")(function* (next: Lockfile) {
    const text = yield* Schema.encodeEffect(LockfileJson)(next).pipe(
      Effect.mapError(fail("Could not encode plugins.json.")),
    );
    yield* writeAtomic(layout.pluginsLock, new TextEncoder().encode(`${text}\n`));
  });

  // An interrupted install leaves the old copy or a hash mismatch, never half-updated code that loads.
  const writeCodeThenManifestThenLock = Effect.fn("PluginStore.writeCodeThenManifestThenLock")(
    function* (
      id: string,
      files: Readonly<Record<string, Uint8Array>>,
      manifest: Uint8Array,
      next: Lockfile,
    ) {
      const folder = path.join(layout.plugins, id);
      for (const [name, bytes] of Object.entries(files))
        yield* writeAtomic(path.join(folder, name), bytes);
      yield* writeAtomic(path.join(folder, PLUGIN_FILES.manifest), manifest);
      yield* writeLock(next);
    },
  );

  const folderOf = (id: string, entry: LockEntry) =>
    entry.source.kind === "github" ? path.join(layout.plugins, id) : entry.source.path;

  // A linked plugin's folder is never written or deleted, but its backend's data folder is.
  const stopProcesses = (id: string, entry: LockEntry | undefined) =>
    entry &&
    options.stopProcesses &&
    (entry.backend !== undefined || (entry.source.kind === "github" && entry.mcp !== undefined))
      ? options.stopProcesses(id, folderOf(id, entry), entry.backend !== undefined)
      : Effect.succeed(Effect.void);

  const inspect = Effect.fn("PluginStore.inspect")(function* (id: string, entry: LockEntry) {
    const base: InstalledPlugin = {
      id,
      name: id,
      description: "",
      version: entry.version,
      source: entry.source,
      ...(entry.sha256 === undefined ? {} : { sha256: entry.sha256 }),
    };
    const folder = folderOf(id, entry);

    const manifestText = yield* fs
      .readFileString(path.join(folder, PLUGIN_FILES.manifest))
      .pipe(Effect.option);
    if (Option.isNone(manifestText)) {
      return failed(base, `manifest.json is missing from ${folder}.`);
    }
    const decoded = yield* Schema.decodeEffect(ManifestJson)(manifestText.value).pipe(
      Effect.result,
    );
    if (Result.isFailure(decoded)) {
      return failed(base, `manifest.json is invalid: ${describeSchemaError(decoded.failure)}`);
    }
    const manifest = decoded.success;
    const described: InstalledPlugin = {
      ...base,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      ...(manifest.author === undefined ? {} : { author: manifest.author }),
    };
    if (manifest.id !== id) {
      return failed(described, `manifest.json has the id "${manifest.id}" instead of "${id}".`);
    }
    if (manifest.api !== PLUGIN_API_VERSION) {
      return failed(
        described,
        `It is built for plugin API ${manifest.api}, and this t3mode runs API ${PLUGIN_API_VERSION}.`,
      );
    }
    const code = yield* fs.readFile(path.join(folder, PLUGIN_FILES.code)).pipe(Effect.option);
    if (Option.isNone(code)) return failed(described, `plugin.js is missing from ${folder}.`);
    if (code.value.byteLength > MAX_PLUGIN_CODE_BYTES) {
      return failed(described, `plugin.js is larger than ${megabytes(MAX_PLUGIN_CODE_BYTES)}.`);
    }
    if (entry.source.kind === "github") {
      if (!entry.files?.[PLUGIN_FILES.code])
        return failed(described, "plugin.js has no installed hash. Install it again.");
      for (const [name, hash] of Object.entries(entry.files ?? {})) {
        const bytes =
          name === PLUGIN_FILES.code
            ? code
            : yield* fs.readFile(path.join(folder, name)).pipe(Effect.option);
        if (Option.isNone(bytes) || (yield* sha256Hex(bytes.value)) !== hash)
          return failed(described, `${name} changed since it was installed. Install it again.`);
      }
    }
    return { plugin: described, code: code.value };
  });

  /** A program script's absolute path, or undefined when it isn't there to run. */
  const programScript = Effect.fn("PluginStore.programScript")(function* (
    folder: string,
    entry: LockEntry,
    name: string | undefined,
  ) {
    if (name === undefined) return undefined;
    // A GitHub plugin's inspect checked every pinned file; a script must be one of them.
    if (entry.source.kind === "github") {
      return entry.files?.[name] === undefined ? undefined : path.join(folder, name);
    }
    const file = path.join(folder, name);
    return (yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))) ? file : undefined;
  });

  /** A plugin's runnable programs, or undefined when it has none or doesn't load. */
  const program = Effect.fn("PluginStore.program")(function* (id: string, entry: LockEntry) {
    if (entry.mcp === undefined && entry.backend === undefined) return undefined;
    if ((yield* inspect(id, entry)).plugin.error !== undefined) return undefined;
    const folder = folderOf(id, entry);
    const linked = entry.source.kind === "local";
    // Install and link record approval with the scripts; this only refuses one that slipped past.
    const mcp = yield* programScript(
      folder,
      entry,
      entry.approved?.mcp === false ? undefined : entry.mcp,
    );
    const backend = yield* programScript(
      folder,
      entry,
      entry.approved?.backend === false ? undefined : entry.backend,
    );
    if (mcp === undefined && backend === undefined) return undefined;
    const modified =
      linked && backend !== undefined
        ? yield* fs.stat(backend).pipe(
            Effect.map((info) => Option.getOrUndefined(info.mtime)?.getTime()),
            Effect.orElseSucceed(() => undefined),
          )
        : undefined;
    const version = linked
      ? `${entry.version}@${modified ?? 0}`
      : Object.entries(entry.files ?? {})
          .map(([name, hash]) => `${name}:${hash}`)
          .join(",");
    return {
      id,
      folder,
      linked,
      ...(mcp === undefined ? {} : { mcp }),
      ...(backend === undefined ? {} : { backend }),
      version,
    } satisfies PluginProgram;
  });

  const inspectAll = readLock.pipe(
    Effect.catch((error) =>
      Effect.logWarning(error.message, error.cause).pipe(Effect.as(EMPTY_LOCK)),
    ),
    Effect.flatMap((current) =>
      Effect.forEach(Object.entries(current.plugins), ([id, entry]) => inspect(id, entry)),
    ),
    Effect.map((items) => items.toSorted((a, b) => a.plugin.name.localeCompare(b.plugin.name))),
  );

  const toScript = (id: string, code: Uint8Array): PageScript => ({
    name: pluginScriptName(id),
    code: wrapPluginCode(id, decoder.decode(code)),
  });

  const probe = Effect.fn("PluginStore.probe")(function* (
    source: GithubSource,
    file: string,
    maxBytes: number,
  ) {
    const url = releaseAssetUrl(options.githubBase, source, file);
    const release =
      source.tag === undefined
        ? `the latest release of ${sourceLabel(source)}`
        : `release ${source.tag} of ${source.owner}/${source.repo}`;
    const response = yield* http
      .get(url)
      .pipe(Effect.mapError(fail(`Could not reach GitHub for ${release}.`)));
    if (response.status === 404) {
      return yield* new DownloadNotFound({
        release,
        message: `No ${releaseAssetName(source, file)} in ${release}. Check the link, and that the release has ${releaseAssetName(source, PLUGIN_FILES.manifest)} and ${releaseAssetName(source, PLUGIN_FILES.code)}.`,
      });
    }
    if (response.status !== 200) {
      return yield* new PluginError({
        message: `GitHub answered ${response.status} for ${file} in ${release}.`,
      });
    }
    const tooLarge = new PluginError({
      message: `${file} in ${release} is larger than ${maxBytes >= 1024 * 1024 ? megabytes(maxBytes) : `${maxBytes / 1024} KB`}.`,
    });
    if (Number(response.headers["content-length"] ?? 0) > maxBytes) return yield* tooLarge;
    const chunks: Array<Uint8Array> = [];
    let size = 0;
    yield* response.stream.pipe(
      Stream.mapError(fail(`Could not download ${file} from ${release}.`)),
      Stream.runForEach((chunk) => {
        size += chunk.byteLength;
        if (size > maxBytes) return Effect.fail(tooLarge);
        chunks.push(chunk);
        return Effect.void;
      }),
    );
    return { bytes: concat(chunks, size), release };
  });

  const download = (source: GithubSource, file: string, maxBytes: number) =>
    probe(source, file, maxBytes).pipe(
      Effect.catchTag("DownloadNotFound", (error) =>
        Effect.fail(new PluginError({ message: error.message })),
      ),
    );

  const fetchManifest = Effect.fn("PluginStore.fetchManifest")(function* (
    source: GithubSource,
    downloaded?: { bytes: Uint8Array; release: string },
  ) {
    const { bytes, release } =
      downloaded ?? (yield* download(source, PLUGIN_FILES.manifest, MAX_PLUGIN_MANIFEST_BYTES));
    const text = decoder.decode(bytes);
    const manifest = yield* Schema.decodeEffect(ManifestJson)(text).pipe(
      Effect.mapError(
        (cause) =>
          new PluginError({
            message: `The manifest.json in ${release} is invalid: ${describeSchemaError(cause)}`,
            cause,
          }),
      ),
    );
    return { manifest, bytes, release };
  });

  const withLock = lock.withPermits(1);

  const installNow = Effect.fn("PluginStore.installNow")(function* (
    source: GithubSource,
    expectedId: string,
    approved: Approval | undefined,
  ) {
    const { manifest, bytes: manifestBytes, release } = yield* fetchManifest(source);
    yield* checkManifest(manifest, release, expectedId);
    const current = yield* readLock;
    yield* checkConflict(current, manifest.id, source);
    const previous = lockEntry(current, manifest.id);
    const access = declaredAccess(manifest);
    const baseline = approved ?? previous?.approved ?? NO_ACCESS;
    if (baseline !== "any" && accessGrew(baseline, access)) {
      return yield* new PluginError({
        message: previous
          ? "This update asks for new access."
          : "This release asks for access you weren't shown. Look at it again before installing.",
        approval: access,
      });
    }
    const files: Record<string, Uint8Array> = {};
    files[PLUGIN_FILES.code] = (yield* download(
      source,
      PLUGIN_FILES.code,
      MAX_PLUGIN_CODE_BYTES,
    )).bytes;
    let total = 0;
    for (const name of extraFiles(manifest)) {
      const cap =
        name === manifest.backend || name === manifest.mcp
          ? MAX_PLUGIN_SCRIPT_BYTES
          : MAX_PLUGIN_ASSET_BYTES;
      const bytes = (yield* download(source, name, Math.min(cap, MAX_PLUGIN_EXTRA_BYTES - total)))
        .bytes;
      total += bytes.byteLength;
      files[name] = bytes;
    }
    const hashes: Record<string, string> = {};
    for (const [name, bytes] of Object.entries(files)) hashes[name] = yield* sha256Hex(bytes);
    // After the downloads, so the plugin's programs are down for as short a time as possible.
    const entry: LockEntry = {
      source,
      version: manifest.version,
      sha256: hashes[PLUGIN_FILES.code]!,
      files: hashes,
      ...(manifest.backend === undefined ? {} : { backend: manifest.backend }),
      ...(manifest.mcp === undefined ? {} : { mcp: manifest.mcp }),
      approved: access,
    };
    // Acquired without interruption, so a stop that happened always gets its resume step.
    yield* Effect.acquireUseRelease(
      stopProcesses(manifest.id, previous),
      () =>
        Effect.gen(function* () {
          yield* writeCodeThenManifestThenLock(manifest.id, files, manifestBytes, {
            ...current,
            plugins: { ...current.plugins, [manifest.id]: entry },
          });
          for (const name of Object.keys(previous?.files ?? {})) {
            if (!Object.hasOwn(files, name))
              yield* fs
                .remove(path.join(layout.plugins, manifest.id, name), { force: true })
                .pipe(Effect.mapError(fail(`Could not delete ${name}.`)));
          }
        }),
      (resume) => resume,
    );
    yield* Effect.logInfo(`Installed ${manifest.id} ${manifest.version} from ${release}`);
    return (yield* inspect(manifest.id, entry)).plugin;
  });

  const entryOf = Effect.fn("PluginStore.entryOf")(function* (id: string) {
    const entry = lockEntry(yield* readLock, id);
    if (!entry) return yield* new PluginError({ message: `"${id}" is not installed.` });
    return entry;
  });

  const preview = Effect.fn("PluginStore.preview")(function* (input: string) {
    const source = parseGithubSource(input);
    if (!source) {
      return yield* new PluginError({
        message: `"${input.trim()}" is not a GitHub repository. Use owner/repo or the repository's link.`,
      });
    }
    const single = yield* probe(source, PLUGIN_FILES.manifest, MAX_PLUGIN_MANIFEST_BYTES).pipe(
      Effect.catchTag("DownloadNotFound", () => Effect.undefined),
    );
    const current = yield* readLock;
    if (single !== undefined) {
      const { manifest, release } = yield* fetchManifest(source, single);
      yield* checkManifest(manifest, release);
      yield* checkConflict(current, manifest.id, source);
      return {
        repo: source,
        offers: [{ kind: "ready", source, manifest }],
      } satisfies PluginPreview;
    }
    const registry = yield* probe(source, PLUGIN_FILES.registry, MAX_PLUGIN_MANIFEST_BYTES).pipe(
      Effect.catchTag("DownloadNotFound", (error) =>
        Effect.fail(
          new PluginError({
            message: `No manifest.json or t3mode.json in ${error.release}. Check the link, and that the release has the plugin's files.`,
          }),
        ),
      ),
    );
    const { plugins } = yield* decodeRegistry(decoder.decode(registry.bytes));
    const offers = yield* Effect.forEach(
      Object.keys(plugins),
      (id) =>
        Effect.gen(function* () {
          const selected = { ...source, plugin: id };
          const { manifest, release } = yield* fetchManifest(selected);
          yield* checkManifest(manifest, release, id);
          yield* checkConflict(current, id, selected);
          return { kind: "ready", source: selected, manifest } satisfies PluginOffer;
        }).pipe(
          Effect.catch((error) =>
            Effect.succeed({
              kind: "unavailable",
              id,
              reason: error.message,
            } satisfies PluginOffer),
          ),
        ),
      { concurrency: 4 },
    );
    return { repo: source, offers } satisfies PluginPreview;
  });

  const install = Effect.fn("PluginStore.install")(
    (source: GithubSource, expectedId: string, approved: Approval) =>
      installNow(source, expectedId, approved),
    withLock,
  );

  const update = Effect.fn("PluginStore.update")(function* (id: string, approved?: Approval) {
    const entry = yield* entryOf(id);
    if (entry.source.kind === "local") {
      return yield* new PluginError({
        message: `"${id}" is linked from ${entry.source.path}. Rebuild it there instead.`,
      });
    }
    if (entry.source.tag !== undefined) {
      return yield* new PluginError({
        message: `"${id}" is pinned to ${entry.source.tag}. Install another release to change it.`,
      });
    }
    return yield* installNow(entry.source, id, approved);
  }, withLock);

  const remove = Effect.fn("PluginStore.remove")(function* (id: string) {
    const current = yield* readLock;
    const entry = lockEntry(current, id);
    if (!entry) return "not-installed" as const;
    const plugins = Object.fromEntries(
      Object.entries(current.plugins).filter(([key]) => key !== id),
    );
    // The folder goes first: when it can't be deleted, the plugin stays listed and remove can run again.
    yield* Effect.acquireUseRelease(
      stopProcesses(id, entry),
      () =>
        Effect.gen(function* () {
          if (entry.source.kind === "github") {
            yield* fs
              .remove(path.join(layout.plugins, id), { recursive: true, force: true })
              .pipe(Effect.mapError(fail(`Could not delete ${path.join(layout.plugins, id)}.`)));
          }
          yield* writeLock({ ...current, plugins });
          // Page storage, then the backend's data folder.
          yield* fs
            .remove(path.join(layout.pluginData, `${id}.json`), { force: true })
            .pipe(Effect.mapError(fail(`Could not delete data for ${id}.`)));
          yield* fs
            .remove(path.join(layout.pluginData, id), { recursive: true, force: true })
            .pipe(Effect.mapError(fail(`Could not delete the data folder of ${id}.`)));
        }),
      (resume) => resume,
    );
    yield* Effect.logInfo(`Removed ${id}`);
    return "removed" as const;
  }, withLock);

  const link = Effect.fn("PluginStore.link")(function* (input: string) {
    const rootFolder = path.resolve(input);
    const registryFile = path.join(rootFolder, PLUGIN_FILES.registry);
    const current = yield* readLock;
    const routes = (yield* fs
      .exists(registryFile)
      .pipe(Effect.mapError(fail(`Could not read ${registryFile}.`))))
      ? Object.entries(
          (yield* decodeRegistry(
            yield* fs
              .readFileString(registryFile)
              .pipe(Effect.mapError(fail(`Could not read ${registryFile}.`))),
          )).plugins,
        )
      : ([[undefined, ""]] as const);
    const entries = yield* Effect.forEach(routes, ([id, route]) =>
      Effect.gen(function* () {
        const folder = path.resolve(rootFolder, route);
        const manifestText = yield* fs
          .readFileString(path.join(folder, PLUGIN_FILES.manifest))
          .pipe(Effect.mapError(fail(`${folder} has no readable manifest.json.`)));
        const manifest = yield* Schema.decodeEffect(ManifestJson)(manifestText).pipe(
          Effect.mapError(
            (cause) =>
              new PluginError({
                message: `The manifest.json in ${folder} is invalid: ${describeSchemaError(cause)}`,
                cause,
              }),
          ),
        );
        yield* checkManifest(manifest, folder, id);
        const hasCode = yield* fs
          .exists(path.join(folder, PLUGIN_FILES.code))
          .pipe(Effect.orElseSucceed(() => false));
        if (!hasCode) {
          return yield* new PluginError({ message: `${folder} has no plugin.js. Build it first.` });
        }
        const source = { kind: "local", path: folder } as const;
        yield* checkConflict(current, manifest.id, source);
        const entry: LockEntry = {
          source,
          version: manifest.version,
          ...(manifest.backend === undefined ? {} : { backend: manifest.backend }),
          ...(manifest.mcp === undefined ? {} : { mcp: manifest.mcp }),
          approved: declaredAccess(manifest),
        };
        return { id: manifest.id, entry };
      }),
    );
    yield* writeLock({
      ...current,
      plugins: {
        ...current.plugins,
        ...Object.fromEntries(entries.map(({ id, entry }) => [id, entry])),
      },
    });
    return yield* Effect.forEach(entries, ({ id, entry }) =>
      inspect(id, entry).pipe(Effect.map(({ plugin }) => plugin)),
    );
  }, withLock);

  const checkUpdates = Effect.gen(function* () {
    const current = yield* readLock;
    const updates: Record<string, string> = {};
    const failures: Record<string, string> = {};
    yield* Effect.forEach(
      Object.entries(current.plugins),
      ([id, entry]) =>
        entry.source.kind !== "github" || entry.source.tag !== undefined
          ? Effect.void
          : fetchManifest(entry.source).pipe(
              Effect.match({
                onFailure: (error) => {
                  failures[id] = error.message;
                },
                onSuccess: ({ manifest }) => {
                  if (manifest.id === id && compareVersions(manifest.version, entry.version) > 0) {
                    updates[id] = manifest.version;
                  }
                },
              }),
            ),
      { concurrency: 4, discard: true },
    );
    return { updates, failures } satisfies UpdateCheck;
  }).pipe(Effect.withSpan("PluginStore.checkUpdates"));

  return PluginStore.of({
    list: inspectAll.pipe(Effect.map((items) => items.map((item) => item.plugin))),
    script: Effect.fn("PluginStore.script")(function* (id: string) {
      const entry = lockEntry(yield* readLock.pipe(Effect.orElseSucceed(() => EMPTY_LOCK)), id);
      if (!entry) return undefined;
      const { code } = yield* inspect(id, entry);
      return code ? toScript(id, code) : undefined;
    }),
    scripts: inspectAll.pipe(
      Effect.map((items) =>
        items.flatMap(({ plugin, code }) => (code ? [toScript(plugin.id, code)] : [])),
      ),
    ),
    preview,
    install,
    update,
    remove,
    link,
    checkUpdates,
    programs: readLock.pipe(
      Effect.orElseSucceed(() => EMPTY_LOCK),
      Effect.flatMap((current) =>
        Effect.forEach(Object.entries(current.plugins), ([id, entry]) => program(id, entry)),
      ),
      Effect.map((programs) => programs.flatMap((item) => (item ? [item] : []))),
      Effect.withSpan("PluginStore.programs"),
    ),
  });
});

export const layer = (options: PluginStoreOptions) => Layer.effect(PluginStore, make(options));
