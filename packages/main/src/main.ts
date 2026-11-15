// The t3mode loader. The shim requires this file, then boots T3 Code right after,
// so everything here runs synchronously and must never throw.
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { app } from "electron";

import { SANDBOX_APPDATA_ENV } from "@t3mode/shared/Layout";
import { T3MODE_VERSION } from "@t3mode/shared/Version";

import * as BootGuard from "./BootGuard.ts";
import * as FileLogger from "./FileLogger.ts";
import * as Files from "./Files.ts";
import * as Home from "./Home.ts";
import * as Ipc from "./Ipc.ts";
import * as Preload from "./Preload.ts";
import * as SettingsStore from "./SettingsStore.ts";
import * as T3Keybindings from "./T3Keybindings.ts";

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

const program = Effect.gen(function* () {
  const guard = yield* BootGuard.BootGuard;
  const decision = yield* guard.begin;
  yield* Effect.logInfo("t3mode loader started", {
    version: T3MODE_VERSION,
    t3code: app.getVersion(),
    mode: decision.mode,
    sandboxed,
  });
  if (decision.mode === "safe") {
    yield* Effect.logWarning(`Safe mode (${decision.reason}): t3mode stays off for this launch`);
    return;
  }
  yield* Ipc.register({ safeMode: false });
  yield* Preload.register();
  yield* guard.watchCrashes;
});

const MainLayer = Layer.mergeAll(BootGuard.layer, SettingsStore.layer, T3Keybindings.layer).pipe(
  Layer.provideMerge(FileLogger.layer),
  Layer.provideMerge(Layer.mergeAll(Files.layer, Home.layer)),
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
