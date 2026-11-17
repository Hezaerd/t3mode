// Finding and starting T3 Code processes on Windows, through PowerShell.
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as String from "effect/String";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { stopProcessesScript } from "@t3mode/shared/ToolServers";

import { CliFailure } from "./Errors.ts";

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

const powershell = (script: string, env?: Readonly<Record<string, string>>) =>
  ChildProcess.make(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    env ? { env, extendEnv: true } : {},
  );

const withSlash = (dir: string) => (dir.endsWith("\\") ? dir : `${dir}\\`);

/**
 * How many processes run from an executable inside `dir`. With `pluginFolders`, plugin processes
 * (whose command line names a file in one of those folders) don't count.
 */
export const countRunningIn = Effect.fn("Processes.countRunningIn")(function* (
  dir: string,
  pluginFolders?: ReadonlyArray<string>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const prefix = quote(withSlash(dir));
  const folders = (pluginFolders ?? []).map((folder) => quote(withSlash(folder))).join(",");
  const script =
    pluginFolders === undefined || pluginFolders.length === 0
      ? `@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith(${prefix}, [StringComparison]::OrdinalIgnoreCase) }).Count`
      : `$f = @(${folders}); @(Get-CimInstance Win32_Process | Where-Object { $p = $_; $p.ExecutablePath -and $p.ExecutablePath.StartsWith(${prefix}, [StringComparison]::OrdinalIgnoreCase) -and -not ($p.CommandLine -and @($f | Where-Object { $p.CommandLine.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -gt 0) }).Count`;
  const output = yield* spawner
    .string(powershell(script))
    .pipe(
      Effect.mapError(
        (cause) => new CliFailure({ message: "Could not list running processes.", cause }),
      ),
    );
  const count = Number.parseInt(String.trim(output), 10);
  return Number.isNaN(count) ? 0 : count;
});

/**
 * Stops every process of `exe` whose command line names a file in `folders`: the plugin tool
 * servers Claude or Codex started. Warns instead of failing.
 */
export const stopPluginProcesses = Effect.fn("Processes.stopPluginProcesses")(function* (
  exe: string,
  folders: ReadonlyArray<string>,
) {
  if (folders.length === 0) return;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const output = yield* spawner
    .string(powershell(stopProcessesScript(exe, folders)))
    .pipe(
      Effect.catch((error) =>
        Console.error(`Could not stop plugin processes: ${error.message}`).pipe(Effect.as("0")),
      ),
    );
  const count = Number.parseInt(String.trim(output), 10);
  if (count > 0) yield* Console.log(`Stopped ${count} plugin tool server process(es).`);
});

/**
 * Fails while T3 Code runs from `dir`, or waits for it to close when `wait` is set. With
 * `plugins`, plugin tool servers running T3 Code's exe don't count as T3 Code, and they are
 * stopped once T3 Code itself is closed, so the command can replace its files.
 */
export const ensureClosed = Effect.fn("Processes.ensureClosed")(function* (
  dir: string,
  wait: boolean,
  plugins?: { readonly exe: string; readonly folders: ReadonlyArray<string> },
) {
  const running = yield* countRunningIn(dir, plugins?.folders);
  if (running > 0 && !wait) {
    return yield* new CliFailure({
      message: `T3 Code is running from ${dir}. Close it, or pass --wait to wait until it closes.`,
    });
  }
  if (running > 0) {
    yield* Console.log("Waiting for T3 Code to close…");
    yield* countRunningIn(dir, plugins?.folders).pipe(
      Effect.repeat({ schedule: Schedule.spaced("2 seconds"), until: (count) => count === 0 }),
    );
  }
  if (plugins) yield* stopPluginProcesses(plugins.exe, plugins.folders);
});

/** Starts `exe` detached from this CLI, so it keeps running after the command exits. */
export const launch = Effect.fn("Processes.launch")(function* (
  exe: string,
  args: ReadonlyArray<string>,
  env?: Readonly<Record<string, string>>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const argumentList = args.length > 0 ? ` -ArgumentList ${args.map(quote).join(",")}` : "";
  yield* spawner
    .string(powershell(`Start-Process -FilePath ${quote(exe)}${argumentList}`, env))
    .pipe(
      Effect.mapError((cause) => new CliFailure({ message: `Could not start ${exe}.`, cause })),
    );
});

/** Mirrors `from` into `to` with robocopy. Exit codes below 8 mean success. */
export const mirror = Effect.fn("Processes.mirror")(function* (from: string, to: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* Effect.scoped(
    spawner
      .spawn(
        ChildProcess.make("robocopy", [from, to, "/MIR", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"]),
      )
      .pipe(Effect.flatMap((handle) => handle.exitCode)),
  ).pipe(Effect.mapError((cause) => new CliFailure({ message: `Could not copy ${from}.`, cause })));
  if (exitCode >= 8) {
    return yield* new CliFailure({
      message: `robocopy failed with exit code ${exitCode} copying ${from}.`,
    });
  }
});
