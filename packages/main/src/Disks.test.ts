import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";

import { parseLogicalDisks } from "./Disks.ts";

describe("parseLogicalDisks", () => {
  it("names each drive by its root and keeps sizes in bytes", async () => {
    const output = '[{"DeviceID":"C:","Size":500000000000,"FreeSpace":125000000000}]\r\n';
    expect(await Effect.runPromise(parseLogicalDisks(output))).toEqual([
      { path: "C:\\", total: 500_000_000_000, free: 125_000_000_000 },
    ]);
  });

  it("leaves out drives without a size", async () => {
    const output =
      '[{"DeviceID":"C:","Size":100,"FreeSpace":40},{"DeviceID":"E:","Size":null,"FreeSpace":null}]';
    expect(await Effect.runPromise(parseLogicalDisks(output))).toEqual([
      { path: "C:\\", total: 100, free: 40 },
    ]);
  });

  it("fails on output that is not the expected JSON", async () => {
    await expect(Effect.runPromise(parseLogicalDisks("Access denied"))).rejects.toBeDefined();
  });
});
