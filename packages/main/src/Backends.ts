// Plugin backends: one Electron utilityProcess per enabled plugin with a `backend` script (see
// "Backends" in docs/architecture.md). The rules live in BackendSupervisor.ts; this module gives
// them Electron's utilityProcess, the plugin's data folder and its log file.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { app, utilityProcess } from "electron";

import { BackendEnv } from "@t3mode/shared/Backends";
import type { HomeLayout } from "@t3mode/shared/Layout";

import { openBackendLog } from "./BackendLog.ts";
import {
  type BackendProcess,
  type Supervisor,
  type WantedBackend,
  makeSupervisor,
} from "./BackendSupervisor.ts";
import { Home } from "./Home.ts";

export type { WantedBackend } from "./BackendSupervisor.ts";

export class Backends extends Context.Service<Backends, Supervisor>()("@t3mode/main/Backends") {}

const spawnUtility =
  (layout: HomeLayout) =>
  (wanted: WantedBackend): BackendProcess => {
    const dataDir = NodePath.join(layout.pluginData, wanted.id);
    NodeFs.mkdirSync(dataDir, { recursive: true });
    // The script goes in the environment: a utility process's command line doesn't carry
    // arguments, so command-line matching can't find a backend. Only main stops one.
    const child = utilityProcess.fork(layout.backendHost, [], {
      serviceName: `t3mode plugin ${wanted.id}`,
      stdio: "pipe",
      cwd: wanted.folder,
      env: {
        ...process.env,
        [BackendEnv.plugin]: wanted.id,
        [BackendEnv.script]: wanted.script,
        [BackendEnv.data]: dataDir,
      },
    });
    return {
      pid: () => child.pid,
      stdout: child.stdout,
      stderr: child.stderr,
      // A utility process's port, not a window: there is no origin to name.
      // eslint-disable-next-line unicorn/require-post-message-target-origin
      postMessage: (message) => child.postMessage(message),
      kill: () => {
        child.kill();
      },
      onSpawn: (listener) => {
        child.on("spawn", listener);
      },
      onMessage: (listener) => {
        child.on("message", listener);
      },
      onExit: (listener) => {
        child.on("exit", listener);
      },
    };
  };

export const make = Effect.gen(function* () {
  const { layout } = yield* Home;
  return Backends.of(
    yield* makeSupervisor({
      spawn: spawnUtility(layout),
      openLog: (id) => openBackendLog(layout.pluginLogs, id),
      isReady: () => app.isReady(),
    }),
  );
});

export const layer = Layer.effect(Backends, make);
