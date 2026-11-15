// Plugins for the page: the scripts the preload runs, and the Plugins page's actions. Page code
// can only name GitHub releases. Local folders come from the CLI alone, and the decode here
// refuses any other source.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient } from "effect/http";

import { RENDERER_SCRIPT_NAME } from "@t3mode/shared/Ipc";
import { githubUrl } from "@t3mode/shared/Layout";
import type { InstalledPlugin, PageScript, PluginResult } from "@t3mode/shared/Plugins";
import * as PluginStore from "@t3mode/shared/PluginStore";
import { compareVersions } from "@t3mode/shared/Semver";

import { Files } from "./Files.ts";
import { Home } from "./Home.ts";

export const PluginActionSchema = Schema.Union([
  Schema.TaggedStruct("list", {}),
  Schema.TaggedStruct("preview", { input: Schema.String }),
  Schema.TaggedStruct("install", {
    source: PluginStore.GithubSourceSchema,
    id: PluginStore.PluginIdSchema,
  }),
  Schema.TaggedStruct("update", { id: PluginStore.PluginIdSchema }),
  Schema.TaggedStruct("remove", { id: PluginStore.PluginIdSchema }),
  Schema.TaggedStruct("check", {}),
]);

export class PluginHost extends Context.Service<
  PluginHost,
  {
    readonly pageScripts: Effect.Effect<ReadonlyArray<PageScript>>;
    readonly pluginScript: (id: unknown) => Effect.Effect<PageScript | null, Schema.SchemaError>;
    readonly act: (input: unknown) => Effect.Effect<unknown, Schema.SchemaError>;
  }
>()("@t3mode/main/PluginHost") {}

const result = <A>(
  effect: Effect.Effect<A, PluginStore.PluginError>,
): Effect.Effect<PluginResult<A>> =>
  effect.pipe(
    Effect.match({
      onFailure: (error) => ({ ok: false, error: error.message }) as const,
      onSuccess: (value) => ({ ok: true, value }) as const,
    }),
  );

export const make = Effect.gen(function* () {
  const files = yield* Files;
  const { layout } = yield* Home;
  const store = yield* PluginStore.make({ layout, githubBase: githubUrl(process.env) });
  let updates: Readonly<Record<string, string>> = {};

  const withUpdate = (plugin: InstalledPlugin): InstalledPlugin => {
    const newer = Object.hasOwn(updates, plugin.id) ? updates[plugin.id] : undefined;
    return newer !== undefined && compareVersions(newer, plugin.version) > 0
      ? { ...plugin, update: newer }
      : plugin;
  };
  const list = store.list.pipe(Effect.map((plugins) => plugins.map(withUpdate)));

  const check = Effect.gen(function* () {
    const found = yield* store.checkUpdates;
    updates = found.updates;
    const failed = Object.entries(found.failures);
    if (failed.length > 0) {
      return yield* new PluginStore.PluginError({
        message: failed.map(([id, message]) => `${id}: ${message}`).join(" "),
      });
    }
    return yield* list;
  });

  const act = Effect.fn("PluginHost.act")(function* (input: unknown) {
    const action = yield* Schema.decodeUnknownEffect(PluginActionSchema)(input);
    switch (action._tag) {
      case "list":
        return yield* list;
      case "preview":
        return yield* result(store.preview(action.input));
      case "install":
        return yield* result(store.install(action.source, action.id).pipe(Effect.map(withUpdate)));
      case "update":
        return yield* result(store.update(action.id).pipe(Effect.map(withUpdate)));
      case "remove":
        return yield* result(store.remove(action.id));
      case "check":
        return yield* result(check);
    }
  });

  const pageScripts = Effect.gen(function* () {
    const plugins = yield* store.scripts.pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Could not read the installed plugins", cause).pipe(Effect.as([])),
      ),
    );
    const renderer = yield* files.readText(layout.rendererJs).pipe(
      Effect.map(Option.getOrElse(() => "")),
      Effect.catch((error) => Effect.logError(error.message, error).pipe(Effect.as(""))),
    );
    return renderer === "" ? plugins : [...plugins, { name: RENDERER_SCRIPT_NAME, code: renderer }];
  });

  return PluginHost.of({
    pageScripts,
    pluginScript: Effect.fn("PluginHost.pluginScript")(function* (input: unknown) {
      const id = yield* Schema.decodeUnknownEffect(PluginStore.PluginIdSchema)(input);
      return (yield* store.script(id)) ?? null;
    }),
    act,
  });
});

export const layer = Layer.effect(PluginHost, make).pipe(Layer.provide(FetchHttpClient.layer));
