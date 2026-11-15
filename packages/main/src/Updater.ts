// t3mode installs T3 Code's updates (see "Updates" in docs/architecture.md and
// @t3mode/shared/Updates). The loader turns T3 Code's own updater off. This service checks
// T3 Code's GitHub feed, downloads the installer, checks its SHA-512 and its Authenticode
// publisher, and when T3 Code quits it starts update-helper.ps1, which waits for T3 Code to
// exit, runs the installer, puts the shim back and, after "Restart now", starts T3 Code again.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { app, net } from "electron";

import { managesUpdates } from "@t3mode/shared/Settings";
import type { UpdatePhase, UpdateStatus } from "@t3mode/shared/Updates";

import { Files } from "./Files.ts";
import { helperArguments, launcherCommand } from "./HelperLaunch.ts";
import { Home } from "./Home.ts";
import { compareVersions } from "./Semver.ts";
import { SettingsStore } from "./SettingsStore.ts";
import {
  parseAppUpdateConfig,
  parseChannelInfo,
  pickInstaller,
  pickRelease,
  resolveChannel,
  signatureRejection,
} from "./UpdateFeed.ts";

/** First check after T3 Code starts, then one an hour. */
const FIRST_CHECK = Duration.seconds(20);
const CHECK_EVERY = Duration.hours(1);
const DEFAULT_PUBLISHERS = ["T3 Tools Inc"];

export class UpdateError extends Schema.TaggedError<UpdateError>()("UpdateError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const Releases = Schema.Array(
  Schema.Struct({
    tag_name: Schema.String,
    draft: Schema.Boolean,
    prerelease: Schema.Boolean,
    assets: Schema.Array(
      Schema.Struct({ name: Schema.String, browser_download_url: Schema.String }),
    ),
  }),
);

const ReadyJson = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.String,
    installer: Schema.String,
    sha512: Schema.String,
    size: Schema.Number,
  }),
);
type Ready = typeof ReadyJson.Type;

const DesktopSettingsJson = Schema.fromJsonString(
  Schema.Struct({ updateChannel: Schema.optionalKey(Schema.Unknown) }),
);

const SignatureJson = Schema.fromJsonString(
  Schema.Struct({ Status: Schema.Number, Subject: Schema.NullOr(Schema.String) }),
);

/** Electron's own network stack, so system proxies apply as they do for T3 Code's updater. */
const electronFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  net.fetch(input instanceof URL ? input.href : (input as string), init)) as typeof fetch;

const fail = (message: string) => (cause: unknown) => new UpdateError({ message, cause });

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export interface UpdaterOptions {
  /** T3 Code's data folder, which holds its desktop settings (the update channel). */
  readonly t3Home: string;
  /** Dev sandbox only: the stand-in installer (SANDBOX_INSTALLER_ENV). */
  readonly sandboxInstaller: string | undefined;
  /** T3CODE_DISABLE_AUTO_UPDATE was already set before the loader ran (the dev sandbox sets it). */
  readonly updaterEnvPreset: boolean;
  readonly sandboxed: boolean;
}

export class Updater extends Context.Service<
  Updater,
  {
    /** t3mode installs updates in this launch, so the loader turns T3 Code's updater off. */
    readonly managed: boolean;
    readonly status: Effect.Effect<UpdateStatus>;
    /** Checks now, unless a check or download is already running. */
    readonly check: Effect.Effect<UpdateStatus>;
    /** Quits T3 Code to install a ready update, then starts it again. */
    readonly restart: Effect.Effect<UpdateStatus>;
    readonly subscribe: (listener: (status: UpdateStatus) => void) => Effect.Effect<void>;
    /** Installs on quit and schedules checks. Call once, from the loader. */
    readonly start: Effect.Effect<void>;
  }
>()("@t3mode/main/Updater") {}

export const make = Effect.fn("Updater.make")(function* (options: UpdaterOptions) {
  const files = yield* Files;
  const settings = yield* SettingsStore;
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const { layout } = yield* Home;
  const http = (yield* HttpClient.HttpClient).pipe(
    HttpClient.filterStatusOk,
    HttpClient.mapRequest(HttpClientRequest.setHeader("user-agent", "t3mode")),
  );
  const current = app.getVersion();
  const installDir = NodePath.dirname(process.execPath);
  const sandboxInstaller = options.sandboxInstaller;
  // The sandbox never runs T3 Code's real installer: it would update the real install.
  const installable = !options.sandboxed || Boolean(sandboxInstaller);
  const lock = yield* Semaphore.make(1);
  const managed = managesUpdates(yield* settings.read);

  let phase: UpdatePhase = { kind: "idle" };
  let checkedAt: number | null = null;
  let ready: Ready | undefined;
  let relaunch = false;
  let helperStarted = false;
  const listeners = new Set<(status: UpdateStatus) => void>();

  const channelNow = Effect.gen(function* () {
    const path = NodePath.join(options.t3Home, "userdata", "desktop-settings.json");
    const text = yield* files.readText(path).pipe(Effect.orElseSucceed(() => Option.none()));
    const configured = Option.isSome(text)
      ? yield* Schema.decodeEffect(DesktopSettingsJson)(text.value).pipe(
          Effect.map((value) => value.updateChannel),
          Effect.orElseSucceed(() => undefined),
        )
      : undefined;
    return resolveChannel(configured, current);
  });

  const status = Effect.gen(function* () {
    const stored = yield* settings.read;
    return {
      managed,
      manageSetting: managesUpdates(stored),
      current,
      channel: yield* channelNow,
      phase,
      checkedAt,
      installable,
    } satisfies UpdateStatus;
  });

  const publish = Effect.fn("Updater.publish")(function* (next: UpdatePhase) {
    phase = next;
    if (listeners.size === 0) return;
    const snapshot = yield* status;
    for (const listener of listeners) {
      yield* Effect.sync(() => {
        try {
          listener(snapshot);
        } catch {
          // A closed page must not stop the updater.
        }
      });
    }
  });

  /** Authenticode signature: valid, and signed by T3 Code's publisher (app-update.yml). */
  const verifySignature = Effect.fn("Updater.verifySignature")(function* (
    file: string,
    publishers: ReadonlyArray<string>,
  ) {
    const output = yield* spawner
      .string(
        ChildProcess.make("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Get-AuthenticodeSignature -LiteralPath ${quote(file)} | Select-Object @{n='Status';e={[int]$_.Status}}, @{n='Subject';e={$_.SignerCertificate.Subject}} | ConvertTo-Json -Compress`,
        ]),
      )
      .pipe(Effect.mapError(fail("Could not check the installer's signature.")));
    const signature = yield* Schema.decodeEffect(SignatureJson)(output.trim()).pipe(
      Effect.mapError(fail("Could not read the installer's signature.")),
    );
    const rejection = signatureRejection(signature.Status, signature.Subject, publishers);
    if (rejection) return yield* new UpdateError({ message: rejection });
  });

  const removeOtherDownloads = Effect.fn("Updater.removeOtherDownloads")(function* (
    keep: string | undefined,
  ) {
    const entries = yield* fs.readDirectory(layout.updates).pipe(Effect.orElseSucceed(() => []));
    for (const entry of entries) {
      const path = NodePath.join(layout.updates, entry);
      if (path === keep || path === layout.updateReady) continue;
      yield* fs.remove(path, { recursive: true, force: true }).pipe(Effect.ignore);
    }
  });

  const forgetReady = Effect.gen(function* () {
    ready = undefined;
    yield* files.remove(layout.updateReady).pipe(Effect.ignore);
    yield* removeOtherDownloads(undefined);
  });

  const download = Effect.fn("Updater.download")(function* (
    version: string,
    url: string,
    expected: { readonly sha512: string; readonly size: number },
    publishers: ReadonlyArray<string>,
  ) {
    const dir = NodePath.join(layout.updates, version.replaceAll(/[^0-9A-Za-z.-]/g, "_"));
    const name = NodePath.basename(new URL(url).pathname).replaceAll(/[^0-9A-Za-z._-]/g, "_");
    const target = NodePath.join(dir, name);
    const partial = `${target}.partial`;
    yield* fs.makeDirectory(dir, { recursive: true });

    const hash = NodeCrypto.createHash("sha512");
    let received = 0;
    let reported = -1;
    yield* publish({ kind: "downloading", version, received, total: expected.size });
    yield* Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fs.open(partial, { flag: "w" });
        yield* http.get(url).pipe(
          Effect.map((response) => response.stream),
          Stream.unwrap,
          Stream.runForEach((chunk) =>
            Effect.gen(function* () {
              hash.update(chunk);
              yield* file.writeAll(chunk);
              received += chunk.byteLength;
              const percent = Math.floor((received / expected.size) * 100);
              if (percent !== reported) {
                reported = percent;
                yield* publish({ kind: "downloading", version, received, total: expected.size });
              }
            }),
          ),
        );
      }),
    ).pipe(Effect.mapError(fail(`Could not download ${version}.`)));

    yield* publish({ kind: "verifying", version });
    const sha512 = hash.digest("base64");
    if (received !== expected.size || sha512 !== expected.sha512) {
      yield* fs.remove(partial, { force: true }).pipe(Effect.ignore);
      return yield* new UpdateError({
        message: `The download of ${version} is damaged (size or SHA-512 differs). It will be tried again.`,
      });
    }
    yield* fs.rename(partial, target).pipe(Effect.mapError(fail(`Could not save ${target}.`)));
    yield* verifySignature(target, publishers).pipe(
      Effect.tapError(() => fs.remove(target, { force: true }).pipe(Effect.ignore)),
    );
    const next: Ready = { version, installer: target, sha512, size: received };
    yield* files.writeTextAtomic(layout.updateReady, yield* Schema.encodeEffect(ReadyJson)(next));
    ready = next;
    yield* removeOtherDownloads(dir);
    yield* Effect.logInfo(`T3 Code ${version} downloaded and verified`, { installer: target });
  });

  const runCheck = Effect.gen(function* () {
    if (phase.kind !== "ready") yield* publish({ kind: "checking" });
    const configText = yield* files
      .readText(NodePath.join(process.resourcesPath, "app-update.yml"))
      .pipe(Effect.mapError(fail("Could not read T3 Code's update settings.")));
    const config = Option.isSome(configText) ? parseAppUpdateConfig(configText.value) : undefined;
    if (!config) {
      return yield* new UpdateError({ message: "This T3 Code build has no GitHub update feed." });
    }
    const publishers =
      config.publisherNames.length > 0 ? config.publisherNames : DEFAULT_PUBLISHERS;
    const channel = yield* channelNow;

    const releases = yield* http
      .get(`https://api.github.com/repos/${config.owner}/${config.repo}/releases?per_page=30`, {
        headers: { accept: "application/vnd.github+json" },
      })
      .pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(Releases)),
        Effect.mapError(fail("Could not reach GitHub to check for updates.")),
      );
    const picked = pickRelease(releases, channel);
    const info = picked
      ? parseChannelInfo(
          yield* http.get(picked.channelFileUrl).pipe(
            Effect.flatMap((response) => response.text),
            Effect.mapError(fail(`Could not read ${channel}.yml.`)),
          ),
        )
      : undefined;
    checkedAt = yield* Clock.currentTimeMillis;

    if (!info || compareVersions(info.version, current) <= 0) {
      if (ready) yield* forgetReady;
      yield* publish({ kind: "up-to-date", latest: info?.version ?? current });
      return;
    }
    if (ready?.version === info.version) {
      yield* publish({ kind: "ready", version: ready.version });
      return;
    }
    const file = pickInstaller(info.files, process.arch);
    if (!file) {
      return yield* new UpdateError({
        message: `T3 Code ${info.version} has no installer for ${process.arch}.`,
      });
    }
    yield* download(info.version, new URL(file.url, picked!.channelFileUrl).href, file, publishers);
    yield* publish({ kind: "ready", version: info.version });
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        checkedAt = yield* Clock.currentTimeMillis;
        yield* Effect.logWarning("Update check failed", error);
        // A failed check never drops an update that is already downloaded.
        yield* publish(
          ready
            ? { kind: "ready", version: ready.version }
            : { kind: "failed", message: error.message },
        );
      }),
    ),
    // Both are read when a request runs, so they are provided here, not to the layer.
    Effect.provideService(FetchHttpClient.Fetch, electronFetch),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.withSpan("Updater.check"),
  );

  const check = lock.withPermitsIfAvailable(1)(runCheck).pipe(Effect.andThen(status));

  /** A download left by an earlier launch: installed since, or still waiting. */
  const restore = Effect.gen(function* () {
    const text = yield* files
      .readText(layout.updateReady)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(text)) return;
    const stored = yield* Schema.decodeEffect(ReadyJson)(text.value).pipe(Effect.option);
    if (Option.isNone(stored) || compareVersions(stored.value.version, current) <= 0) {
      if (Option.isSome(stored)) yield* Effect.logInfo(`T3 Code updated to ${current}`);
      yield* forgetReady;
      return;
    }
    const size = yield* fs.stat(stored.value.installer).pipe(
      Effect.map((info) => Number(info.size)),
      Effect.orElseSucceed(() => -1),
    );
    if (size !== stored.value.size) {
      yield* forgetReady;
      return;
    }
    ready = stored.value;
    yield* publish({ kind: "ready", version: ready.version });
  });

  /**
   * Runs in Electron's will-quit, so it is synchronous. It waits for the launcher (about half a
   * second), so the helper is running before T3 Code exits. See HelperLaunch.ts.
   */
  const startHelper = (): void => {
    if (helperStarted || !ready || !installable) return;
    const installer = options.sandboxed ? sandboxInstaller : ready.installer;
    if (!installer) return;
    const args = helperArguments({
      script: layout.updateHelper,
      parentPid: process.pid,
      installer,
      installDir,
      repairJs: layout.repairJs,
      shimJs: layout.shimJs,
      home: layout.root,
      log: layout.updateLog,
      version: ready.version,
      relaunch,
      relaunchArgs: process.argv.slice(1),
      keepUpdaterEnv: options.updaterEnvPreset,
    });
    const result = NodeChildProcess.spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", launcherCommand(args)],
      { windowsHide: true, timeout: 20_000, encoding: "utf8" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`The update launcher exited with ${result.status}: ${result.stderr.trim()}`);
    }
    helperStarted = true;
  };

  const restart = Effect.gen(function* () {
    if (phase.kind === "ready" && installable && managed) {
      relaunch = true;
      yield* Effect.logInfo(`Restarting to install T3 Code ${ready?.version}`);
      yield* Effect.sync(() => app.quit());
    }
    return yield* status;
  });

  const start = Effect.gen(function* () {
    if (!managed) return;
    const context = yield* Effect.context<never>();
    const run = Effect.runForkWith(context);
    // T3 Code exits right after will-quit, so these log lines are written synchronously.
    const runNow = Effect.runSyncWith(context);
    yield* Effect.sync(() => {
      app.on("will-quit", () => {
        if (!ready || helperStarted) return;
        const helperFiles = [layout.updateHelper, layout.repairJs, layout.shimJs];
        try {
          if (!helperFiles.every((file) => NodeFs.existsSync(file))) {
            runNow(
              Effect.logWarning(
                "Update not installed: the update helper is missing. Run pnpm t3mode deploy.",
              ),
            );
            return;
          }
          startHelper();
          if (helperStarted) {
            runNow(Effect.logInfo(`Installing T3 Code ${ready.version} after quit`, { relaunch }));
          }
        } catch (error) {
          runNow(Effect.logError("Could not start the update helper", error));
        }
      });
      run(
        Effect.gen(function* () {
          yield* Effect.promise(() => app.whenReady());
          yield* Effect.sleep(FIRST_CHECK);
          yield* restore;
          yield* check.pipe(Effect.repeat(Schedule.spaced(CHECK_EVERY)));
        }).pipe(Effect.catchCause((cause) => Effect.logError("Updater stopped", cause))),
      );
    });
  });

  return Updater.of({
    managed,
    status,
    check,
    restart,
    subscribe: Effect.fn("Updater.subscribe")(function* (listener: (status: UpdateStatus) => void) {
      yield* Effect.sync(() => listeners.add(listener));
    }),
    start,
  });
});

export const layer = (options: UpdaterOptions) =>
  Layer.effect(Updater, make(options)).pipe(Layer.provide(FetchHttpClient.layer));
