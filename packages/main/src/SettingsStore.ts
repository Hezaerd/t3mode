// settings.json: decoded with Schema on every read, written atomically. A missing or invalid
// file reads as defaults, so a bad edit can never keep T3 Code or t3mode from starting.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { type Settings, defaultSettings } from "@t3mode/shared/Settings";

import { Files, type FilesError } from "./Files.ts";
import { Home } from "./Home.ts";

const PluginSettingsSchema = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  options: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

export const SettingsSchema = Schema.Struct({
  version: Schema.Literal(1),
  plugins: Schema.Record(Schema.String, PluginSettingsSchema),
});

const SettingsJson = Schema.fromJsonString(SettingsSchema);

export class SettingsStore extends Context.Service<
  SettingsStore,
  {
    readonly read: Effect.Effect<Settings>;
    readonly write: (input: unknown) => Effect.Effect<void, Schema.SchemaError | FilesError>;
  }
>()("@t3mode/main/SettingsStore") {}

export const layer = Layer.effect(
  SettingsStore,
  Effect.gen(function* () {
    const files = yield* Files;
    const { layout } = yield* Home;

    const read = files.readText(layout.settings).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed<Settings>(defaultSettings),
          onSome: (text) => Schema.decodeEffect(SettingsJson)(text),
        }),
      ),
      Effect.catch((error) =>
        Effect.logWarning("settings.json unreadable, using defaults", error).pipe(
          Effect.as(defaultSettings),
        ),
      ),
      Effect.withSpan("SettingsStore.read"),
    );

    const write = Effect.fn("SettingsStore.write")(function* (input: unknown) {
      const settings = yield* Schema.decodeUnknownEffect(SettingsSchema)(input);
      const text = yield* Schema.encodeEffect(SettingsJson)(settings);
      yield* files.writeTextAtomic(layout.settings, text);
    });

    return SettingsStore.of({ read, write });
  }),
);
