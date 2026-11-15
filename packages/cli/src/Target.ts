// Which T3 Code install and which t3mode home a command works on.
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { type HomeLayout, homeLayout, resolveHomeRoot } from "@t3mode/shared/Layout";

import { CliFailure } from "./Errors.ts";

export interface Target {
  readonly installDir: string;
  readonly resourcesDir: string;
  readonly exe: string;
  readonly home: HomeLayout;
}

export interface TargetFlags {
  readonly installDir: Option.Option<string>;
  readonly home: Option.Option<string>;
}

const defaultInstallDir = Effect.gen(function* () {
  const path = yield* Path.Path;
  const localAppData = yield* Config.String("LOCALAPPDATA");
  return path.join(localAppData, "Programs", "t3code");
});

const defaultHome = Effect.gen(function* () {
  return resolveHomeRoot(process.env, yield* Config.String("USERPROFILE"));
});

export const resolveHome = Effect.fn("Target.resolveHome")(
  function* (home: Option.Option<string>) {
    const path = yield* Path.Path;
    return homeLayout(Option.isSome(home) ? path.resolve(home.value) : yield* defaultHome);
  },
  Effect.mapError(
    (cause) => new CliFailure({ message: "Could not find the t3mode home folder.", cause }),
  ),
);

export const resolve = Effect.fn("Target.resolve")(
  function* (flags: TargetFlags) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const installDir = Option.isSome(flags.installDir)
      ? path.resolve(flags.installDir.value)
      : yield* defaultInstallDir;
    const home = yield* resolveHome(flags.home);

    const entries = yield* fs
      .readDirectory(installDir)
      .pipe(
        Effect.mapError(
          (cause) => new CliFailure({ message: `No T3 Code install at ${installDir}.`, cause }),
        ),
      );
    const exeName = entries.find(
      (name) => name.toLowerCase().endsWith(".exe") && !name.toLowerCase().startsWith("uninstall"),
    );
    if (!exeName) {
      return yield* new CliFailure({ message: `No T3 Code executable in ${installDir}.` });
    }
    return {
      installDir,
      resourcesDir: path.join(installDir, "resources"),
      exe: path.join(installDir, exeName),
      home,
    } satisfies Target;
  },
  Effect.mapError((error) =>
    error._tag === "CliFailure"
      ? error
      : new CliFailure({ message: "Could not resolve the T3 Code install.", cause: error }),
  ),
);
