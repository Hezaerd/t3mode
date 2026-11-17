// Keeps what runs for plugins in step with the enabled plugins: their backends (see "Backends" in
// docs/architecture.md) and their tool servers in Claude's and Codex's MCP config (see "Tool
// servers"). One reconcile runs at launch, after every settings write, after every install,
// update and remove, and when the page loads again. It never fails, and a run with nothing to
// change writes nothing and starts no process.
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

import { Backends } from "./Backends.ts";
import { Home } from "./Home.ts";
import { LinkedFolders } from "./LinkedFolders.ts";
import * as PluginProcesses from "./PluginProcesses.ts";
import { PluginHost } from "./PluginHost.ts";
import { SettingsStore } from "./SettingsStore.ts";

export class Reconcile extends Context.Service<
  Reconcile,
  {
    /** Queues a reconcile in the background. Runs that pile up while one runs collapse into one. */
    readonly refresh: Effect.Effect<void>;
    /** The first reconcile, after app ready. */
    readonly start: Effect.Effect<void>;
  }
>()("@t3mode/main/Reconcile") {}

export const make = Effect.gen(function* () {
  const plugins = yield* PluginHost;
  const settings = yield* SettingsStore;
  const backends = yield* Backends;
  const linked = yield* LinkedFolders;
  const fs = yield* FileSystem.FileSystem;
  const { layout } = yield* Home;
  const lock = yield* Semaphore.make(1);
  const target = { exe: process.execPath, home: layout.root };

  const reconcile = Effect.gen(function* () {
    const current = yield* settings.read;
    const all = yield* plugins.programs;
    const enabled = all.filter((program) => current.plugins[program.id]?.enabled ?? true);
    // A disabled plugin runs no backend code.
    yield* backends.apply(
      enabled.flatMap((program) =>
        program.backend === undefined
          ? []
          : [
              {
                id: program.id,
                folder: program.folder,
                script: program.backend,
                version: program.version,
              },
            ],
      ),
    );
    const servers = enabled.flatMap((program) =>
      program.mcp === undefined ? [] : [{ id: program.id, script: program.mcp }],
    );
    // For the update helper, which stops tool servers that run from these folders.
    linked.set(
      enabled
        .filter((program) => program.linked && program.mcp !== undefined)
        .map((program) => program.folder),
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
    const folders = new Map(all.map((program) => [program.id, program.folder]));
    const disabled: Array<string> = [];
    for (const id of result.removed) {
      const folder = folders.get(id) ?? NodePath.join(layout.plugins, id);
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
    Effect.catchCause((cause) => Effect.logError("Could not reconcile the plugins", cause)),
    Effect.withSpan("Reconcile.run"),
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

  return Reconcile.of({
    refresh,
    start: Effect.sync(() => {
      run(Effect.promise(() => app.whenReady()).pipe(Effect.andThen(refresh)));
    }),
  });
});

export const layer = Layer.effect(Reconcile, make);
