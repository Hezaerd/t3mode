// Size and free space of the local fixed drives, for plugins. One CIM query answers both and never
// touches network or removable drives, which can block for seconds when they are offline.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/process";

import type { Disk } from "@t3mode/shared/Ipc";

import { windowsPowerShell } from "./PowerShell.ts";

const FIXED_DRIVES_COMMAND =
  "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID, Size, FreeSpace)";

const LogicalDisksJson = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      DeviceID: Schema.String,
      Size: Schema.NullOr(Schema.Number),
      FreeSpace: Schema.NullOr(Schema.Number),
    }),
  ),
);

/** Drives that report no size, such as an unformatted partition, are left out. */
export const parseLogicalDisks = (output: string) =>
  Schema.decodeEffect(LogicalDisksJson)(output.trim()).pipe(
    Effect.map((drives) =>
      drives.flatMap((drive): ReadonlyArray<Disk> =>
        drive.Size === null || drive.FreeSpace === null || drive.Size <= 0
          ? []
          : [{ path: `${drive.DeviceID}\\`, total: drive.Size, free: drive.FreeSpace }],
      ),
    ),
  );

export class DisksError extends Schema.TaggedError<DisksError>()("DisksError", {
  reason: Schema.String,
}) {
  override get message(): string {
    return `Could not read the drives: ${this.reason}`;
  }
}

export class Disks extends Context.Service<
  Disks,
  { readonly list: Effect.Effect<ReadonlyArray<Disk>, DisksError> }
>()("@t3mode/main/Disks") {}

export const layer = Layer.effect(
  Disks,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const query = spawner.string(windowsPowerShell(FIXED_DRIVES_COMMAND)).pipe(
      Effect.flatMap(parseLogicalDisks),
      Effect.timeout("15 seconds"),
      Effect.mapError((cause) => new DisksError({ reason: String(cause) })),
      Effect.withSpan("Disks.list"),
    );
    // Every plugin that polls shares one query, and a failure is retried on the next call.
    const list = yield* Effect.cachedWithTTL(query, (exit) =>
      Exit.isSuccess(exit) ? "30 seconds" : 0,
    );
    return Disks.of({ list });
  }),
);
