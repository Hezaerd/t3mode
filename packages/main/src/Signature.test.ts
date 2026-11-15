// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/process";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { SignatureJson, signatureCommand } from "./Signature.ts";

const readSignature = (file: string) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const output = yield* spawner.string(signatureCommand(file));
    return yield* Schema.decodeEffect(SignatureJson)(output.trim());
  }).pipe(Effect.provide(NodeServices.layer), Effect.runPromise);

const powerShell7Home = (() => {
  if (process.platform !== "win32") return undefined;
  try {
    return NodeChildProcess.execFileSync("pwsh", ["-NoProfile", "-Command", "$PSHOME"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return undefined;
  }
})();

describe.runIf(process.platform === "win32")("signatureCommand", { timeout: 30_000 }, () => {
  const saved = process.env.PSModulePath;
  afterEach(() => {
    if (saved === undefined) delete process.env.PSModulePath;
    else process.env.PSModulePath = saved;
  });

  it("reads a valid signature", async () => {
    const signature = await readSignature(process.execPath);
    expect(signature.Status).toBe(0);
    expect(signature.Subject).toMatch(/CN=/);
  });

  it.runIf(powerShell7Home)(
    "reads a valid signature under PowerShell 7's PSModulePath",
    async () => {
      process.env.PSModulePath = [NodePath.join(powerShell7Home!, "Modules"), saved]
        .filter(Boolean)
        .join(";");
      const signature = await readSignature(process.execPath);
      expect(signature.Status).toBe(0);
    },
  );
});
