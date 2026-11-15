// Puts the shim back after a T3 Code update replaced app.asar. update-helper.ps1 runs this
// bundle (dist/repair.cjs, deployed to the t3mode home) with T3 Code's own exe in Node mode
// (ELECTRON_RUN_AS_NODE=1), right after the installer finishes, so no Node install is needed.
//   repair.cjs <install dir> <shim entry> <t3mode home>
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as AsarArchive from "./Asar.ts";
import { CliFailure } from "./Errors.ts";
import * as Install from "./Install.ts";
import * as Target from "./Target.ts";

// In Electron's Node mode, `fs` reads .asar files as folders. The shim swap moves them as files.
(process as { noAsar?: boolean }).noAsar = true;

const program = Effect.gen(function* () {
  const [installDir, shimEntry, home] = process.argv.slice(2);
  if (!installDir || !shimEntry || !home) {
    return yield* new CliFailure({
      message: "Usage: repair.cjs <install dir> <shim entry> <home>",
    });
  }
  const target = yield* Target.resolve({
    installDir: Option.some(installDir),
    home: Option.some(home),
  });
  const result = yield* Install.applyShim(target, shimEntry);
  yield* Console.log(`repair: ${result}`);
});

program.pipe(
  Effect.provide(AsarArchive.layer.pipe(Layer.provideMerge(NodeServices.layer))),
  NodeRuntime.runMain,
);
