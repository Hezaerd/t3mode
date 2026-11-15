// The t3mode loader. The shim requires this file, then boots T3 Code right after,
// so everything here runs synchronously and must never throw.
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { app } from "electron";

import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";

import { SANDBOX_APPDATA_ENV, SANDBOX_INSTALLER_ENV, t3HomePath } from "@t3mode/shared/Layout";
import { T3MODE_VERSION } from "@t3mode/shared/Version";

import * as BootGuard from "./BootGuard.ts";
import * as FileLogger from "./FileLogger.ts";
import * as Files from "./Files.ts";
import * as Home from "./Home.ts";
import * as Ipc from "./Ipc.ts";
import * as PluginHost from "./PluginHost.ts";
import * as Preload from "./Preload.ts";
import * as SettingsStore from "./SettingsStore.ts";
import * as T3Keybindings from "./T3Keybindings.ts";
import * as Updater from "./Updater.ts";

/** T3 Code's own switch for its updater (apps/desktop DesktopConfig). */
const T3_UPDATER_OFF_ENV = "T3CODE_DISABLE_AUTO_UPDATE";

/**
 * Dev sandbox (`pnpm t3mode sandbox`): send T3 Code's own data to a throwaway folder, so the
 * copy gets its own profile and single-instance lock. Plain code on purpose: it edits
 * process.env, and it must run before T3 Code's main reads it.
 */
const applySandbox = (): boolean => {
  const appData = process.env[SANDBOX_APPDATA_ENV]?.trim();
  if (!appData) return false;
  // T3 Code reads APPDATA from the environment (DesktopConfig); Chromium uses Electron's path.
  process.env["APPDATA"] = appData;
  app.setPath("appData", appData);
  return true;
};

const sandboxed = applySandbox();
const updaterEnvPreset = Boolean(process.env[T3_UPDATER_OFF_ENV]?.trim());
const updaterOptions: Updater.UpdaterOptions = {
  t3Home: t3HomePath(process.env, app.getPath("home")),
  sandboxInstaller: process.env[SANDBOX_INSTALLER_ENV]?.trim() || undefined,
  updaterEnvPreset,
  sandboxed,
};
const turnOffT3Updater = (): void => {
  process.env[T3_UPDATER_OFF_ENV] = "1";
};

const program = Effect.gen(function* () {
  const guard = yield* BootGuard.BootGuard;
  const decision = yield* guard.begin;
  yield* Effect.logInfo("t3mode loader started", {
    version: T3MODE_VERSION,
    t3code: app.getVersion(),
    mode: decision.mode,
    sandboxed,
  });
  // Before T3 Code's main reads its config, and in safe mode too: an update installed by
  // T3 Code's own updater would remove t3mode.
  const updater = yield* Updater.Updater;
  if (updater.managed) yield* Effect.sync(turnOffT3Updater);
  yield* updater.start;
  if (decision.mode === "safe") {
    yield* Effect.logWarning(`Safe mode (${decision.reason}): t3mode stays off for this launch`);
    return;
  }
  yield* Ipc.register({ safeMode: false });
  yield* Preload.register();
  yield* guard.watchCrashes;
});

const PlatformLayer = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

const MainLayer = Layer.mergeAll(
  BootGuard.layer,
  T3Keybindings.layer,
  Updater.layer(updaterOptions),
  PluginHost.layer,
).pipe(
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(FileLogger.layer),
  Layer.provideMerge(Layer.mergeAll(Files.layer, Home.layer, PlatformLayer)),
);

try {
  Effect.runSync(
    program.pipe(
      Effect.catchCause((cause) => Effect.logError("t3mode loader failed", cause)),
      Effect.provide(MainLayer),
    ),
  );
} catch (error) {
  // The shim logs whatever escapes, then boots T3 Code anyway.
  throw new Error("t3mode loader failed", { cause: error });
}
