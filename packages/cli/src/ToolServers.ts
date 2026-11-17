// The CLI's side of plugin tool servers: after `plugin add/update/remove/link` it brings Claude's
// and Codex's config in step, as T3 Code does at launch, and `uninstall` takes t3mode's entries
// out. See "Tool servers" in docs/architecture.md.
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { HomeLayout } from "@t3mode/shared/Layout";
import * as Shared from "@t3mode/shared/ToolServers";

import * as Processes from "./Processes.ts";

const SettingsJson = Schema.fromJsonString(
  Schema.Struct({
    plugins: Schema.Record(
      Schema.String,
      Schema.Struct({ enabled: Schema.optionalKey(Schema.Boolean) }),
    ),
  }),
);

/** Plugins turned off on the Plugins page. settings.json is main's; a bad file means none. */
const disabledIds = Effect.fn("ToolServers.disabledIds")(function* (layout: HomeLayout) {
  const fs = yield* FileSystem.FileSystem;
  const settings = yield* fs.readFileString(layout.settings).pipe(
    Effect.flatMap(Schema.decodeEffect(SettingsJson)),
    Effect.orElseSucceed(() => ({ plugins: {} })),
  );
  return new Set(
    Object.entries(settings.plugins)
      .filter(([, plugin]) => plugin.enabled === false)
      .map(([id]) => id),
  );
});

/** Registers `servers` minus the disabled ones, and stops the processes of disabled plugins. */
export const reconcile = Effect.fn("ToolServers.reconcile")(function* (
  target: { readonly exe: string; readonly home: HomeLayout },
  servers: ReadonlyArray<Shared.ToolServer>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const userHome = yield* Config.String("USERPROFILE").pipe(Config.withDefault(""));
  const disabled = yield* disabledIds(target.home);
  const result = yield* Shared.sync({
    target: { exe: target.exe, home: target.home.root },
    paths: Shared.configPaths(process.env, userHome, path.join),
    pluginsFolder: target.home.plugins,
    servers: servers.filter((server) => !disabled.has(server.id)),
  });
  for (const { config, id } of result.conflicts) {
    yield* Console.error(
      `${config} already has a ${Shared.toolServerName(id)} that t3mode didn't write; ${id}'s tools aren't added there.`,
    );
  }
  for (const { message } of result.failures) yield* Console.error(message);
  const folders: Array<string> = [];
  for (const id of result.removed) {
    const folder = path.join(target.home.plugins, id);
    if (yield* fs.exists(folder).pipe(Effect.orElseSucceed(() => false))) folders.push(folder);
  }
  yield* Processes.stopPluginProcesses(target.exe, folders);
});
