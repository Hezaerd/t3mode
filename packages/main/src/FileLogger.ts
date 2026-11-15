import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";

import { Files } from "./Files.ts";
import { Home } from "./Home.ts";

/** Appends logfmt lines to `logs/main.log`. Writes are synchronous, so nothing is lost when T3 Code exits. */
export const layer = Logger.layer([
  Effect.gen(function* () {
    const files = yield* Files;
    const { layout } = yield* Home;
    const run = Effect.runSyncWith(yield* Effect.context<never>());
    return Logger.formatLogFmt.pipe(
      Logger.map((line) => {
        run(files.append(layout.mainLog, `${line}\n`).pipe(Effect.ignore));
      }),
    );
  }),
]);
