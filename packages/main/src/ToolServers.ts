// Keeps Claude's and Codex's MCP config in step with the enabled plugins' tool servers (see "Tool
// servers" in docs/architecture.md). One reconcile runs at launch, after every settings write and
// after every install, update and remove. It never fails, and a run with nothing to change writes
// nothing and starts no process.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import type { ChildProcessSpawner } from "effect/process";

import { app } from "electron";

import * as Shared from "@t3mode/shared/ToolServers";

import { Home } from "./Home.ts";
import * as PluginProcesses from "./PluginProcesses.ts";
import { PluginHost } from "./PluginHost.ts";
import { SettingsStore } from "./SettingsStore.ts";

export class ToolServers extends Context.Service<
  ToolServers,
  {
    /** Queues a reconcile in the background. Runs that pile up while one runs collapse into one. */
    readonly refresh: Effect.Effect<void>;
    /** The first reconcile, after app ready. */
    readonly start: Effect.Effect<void>;
  }
>()("@t3mode/main/ToolServers") {}

export const make = Effect.gen(function* () {
  const plugins = yield* PluginHost;
  const settings = yield* SettingsStore;
  const fs = yield* FileSystem.FileSystem;
  const { layout } = yield* Home;
  const lock = yield* Semaphore.make(1);
  const target = { exe: process.execPath, home: layout.root };

  const reconcile = Effect.gen(function* () {
    const current = yield* settings.read;
    const servers = (yield* plugins.toolServers).filter(
      (server) => current.plugins[server.id]?.enabled ?? true,
    );
    const result = yield* Shared.sync({
      target,
      paths: Shared.configPaths(process.env, app.getPath("home"), NodePath.join),
      pluginsFolder: layout.plugins,
      servers,
    });
    for (const { config, id } of result.conflicts) {
      yield* Effect.logWarning(
        `${config} already has a ${Shared.toolServerName(id)} that t3mode didn't write; ${id}'s tools aren't added there.`,
      );
    }
    for (const { message } of result.failures) yield* Effect.logWarning(message);
    // A removed plugin's processes were stopped by the remove. A disabled one's still run.
    const disabled: Array<string> = [];
    for (const id of result.removed) {
      const folder = NodePath.join(layout.plugins, id);
      if (yield* fs.exists(folder).pipe(Effect.orElseSucceed(() => false))) disabled.push(folder);
    }
    yield* PluginProcesses.stop(disabled);
    if (result.removed.length > 0 || servers.length > 0) {
      yield* Effect.logDebug("Tool servers reconciled", {
        registered: servers.map((server) => server.id),
        removed: result.removed,
      });
    }
  }).pipe(
    Effect.catchCause((cause) => Effect.logError("Could not update the tool servers", cause)),
    Effect.withSpan("ToolServers.reconcile"),
  );

  const run = Effect.runForkWith(
    yield* Effect.context<
      FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
    >(),
  );
  let queued = false;
  const refresh = Effect.sync(() => {
    if (queued) return;
    queued = true;
    run(
      lock.withPermits(1)(
        Effect.sync(() => {
          queued = false;
        }).pipe(Effect.andThen(reconcile)),
      ),
    );
  });

  return ToolServers.of({
    refresh,
    start: Effect.sync(() => {
      run(Effect.promise(() => app.whenReady()).pipe(Effect.andThen(refresh)));
    }),
  });
});

export const layer = Layer.effect(ToolServers, make);
