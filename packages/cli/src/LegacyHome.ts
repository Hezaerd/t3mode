import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { CliFailure } from "./Errors.ts";

export const move = Effect.fn("LegacyHome.move")(
  function* (legacy: string, root: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (path.resolve(legacy) === path.resolve(root) || !(yield* fs.exists(legacy))) return;
    if (yield* fs.exists(root)) {
      yield* Console.log(`The old folder ${legacy} is unused and can be deleted. Using ${root}.`);
      return;
    }
    yield* fs.makeDirectory(path.dirname(root), { recursive: true });
    yield* fs.rename(legacy, root);
    yield* Console.log(`Moved ${legacy} to ${root}.`);
  },
  (effect, legacy, root) =>
    effect.pipe(
      Effect.mapError(
        (cause) =>
          new CliFailure({
            message: `Could not move ${legacy} to ${root}. Move the folder by hand, then try again.`,
            cause,
          }),
      ),
    ),
);
