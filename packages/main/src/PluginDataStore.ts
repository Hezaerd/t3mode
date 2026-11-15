// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { isPluginId, type PluginDataSnapshot } from "@t3mode/shared/Plugins";

import { Files, type FilesError } from "./Files.ts";
import { Home } from "./Home.ts";

const DataSchema = Schema.Record(Schema.String, Schema.Unknown);
const DataJson = Schema.fromJsonString(DataSchema);
const IdSchema = Schema.String.check(
  Schema.makeFilter(isPluginId, { expected: "a valid plugin id" }),
);
const MAX_BYTES = 1024 * 1024;

export class PluginDataError extends Schema.TaggedError<PluginDataError>()("PluginDataError", {
  message: Schema.String,
}) {}

export class PluginDataStore extends Context.Service<
  PluginDataStore,
  {
    readonly read: Effect.Effect<PluginDataSnapshot>;
    readonly write: (
      id: unknown,
      data: unknown,
    ) => Effect.Effect<void, Schema.SchemaError | FilesError | PluginDataError>;
  }
>()("@t3mode/main/PluginDataStore") {}

export const layer = Layer.effect(
  PluginDataStore,
  Effect.gen(function* () {
    const files = yield* Files;
    const { layout } = yield* Home;
    const read = Effect.gen(function* () {
      const names = yield* files.list(layout.pluginData);
      const entries: Array<readonly [string, typeof DataSchema.Type]> = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -5);
        if (!isPluginId(id)) continue;
        const data = yield* files.readText(NodePath.join(layout.pluginData, name)).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(Option.none<typeof DataSchema.Type>()),
              onSome: (text) => Schema.decodeEffect(DataJson)(text).pipe(Effect.asSome),
            }),
          ),
          Effect.catch((error) =>
            Effect.logWarning(`Plugin data ${name} unreadable, skipping`, error).pipe(
              Effect.as(Option.none<typeof DataSchema.Type>()),
            ),
          ),
        );
        if (Option.isSome(data)) entries.push([id, data.value]);
      }
      return Object.fromEntries(entries);
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Plugin data folder unreadable, using empty data", error).pipe(
          Effect.as<PluginDataSnapshot>({}),
        ),
      ),
    );
    const write = Effect.fn("PluginDataStore.write")(function* (inputId: unknown, input: unknown) {
      const id = yield* Schema.decodeUnknownEffect(IdSchema)(inputId);
      const data = yield* Schema.decodeUnknownEffect(DataSchema)(input);
      const text = yield* Schema.encodeEffect(DataJson)(data);
      if (new TextEncoder().encode(text).byteLength > MAX_BYTES) {
        return yield* new PluginDataError({ message: "Plugin data exceeds the 1 MiB limit." });
      }
      yield* files.writeTextAtomic(NodePath.join(layout.pluginData, `${id}.json`), text);
    });
    return PluginDataStore.of({ read, write });
  }),
);
