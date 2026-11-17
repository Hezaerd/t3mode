// Stopping the processes a plugin runs outside T3 Code's window: its tool servers, started by
// Claude or Codex with T3 Code's exe. One PowerShell call per batch of plugin folders.
import * as Effect from "effect/Effect";
import * as String from "effect/String";
import { ChildProcessSpawner } from "effect/process";

import { stopProcessesScript } from "@t3mode/shared/ToolServers";

import { windowsPowerShell } from "./PowerShell.ts";

/** Stops every process of this exe whose command line names a file in `folders`. Never fails. */
export const stop = Effect.fn("PluginProcesses.stop")(function* (folders: ReadonlyArray<string>) {
  if (folders.length === 0) return;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* spawner.string(windowsPowerShell(stopProcessesScript(process.execPath, folders))).pipe(
    Effect.flatMap((output) => {
      const count = Number.parseInt(String.trim(output), 10);
      return count > 0
        ? Effect.logInfo(`Stopped ${count} plugin process(es)`, { folders })
        : Effect.void;
    }),
    Effect.catch((error) => Effect.logWarning("Could not stop plugin processes", error)),
  );
});
