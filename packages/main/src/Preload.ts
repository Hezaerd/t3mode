import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { app, session, type Session } from "electron";

import { Home } from "./Home.ts";

export class PreloadRegisterError extends Schema.TaggedError<PreloadRegisterError>()(
  "PreloadRegisterError",
  { cause: Schema.Defect() },
) {}

/**
 * Registers the t3mode preload on every session, current and future. The preload
 * itself does nothing outside T3 Code's main window.
 */
export const register = Effect.fn("Preload.register")(function* () {
  const { layout } = yield* Home;
  const run = Effect.runSyncWith(yield* Effect.context<never>());
  const seen = new WeakSet<Session>();

  const add = (target: Session) => {
    if (seen.has(target)) return;
    seen.add(target);
    run(
      Effect.try({
        try: () =>
          target.registerPreloadScript({ id: "t3mode", type: "frame", filePath: layout.preloadJs }),
        catch: (cause) => new PreloadRegisterError({ cause }),
      }).pipe(
        Effect.catch((error) => Effect.logError("Could not register the preload", error.cause)),
      ),
    );
  };

  yield* Effect.sync(() => {
    app.on("session-created", add);
    void app.whenReady().then(() => add(session.defaultSession));
  });
});
