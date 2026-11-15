// Replays the AsarSwap findings (F1, F2) on the real Install.ts, with a FileSystem that fails
// one chosen call. To run it, copy it to packages/cli/src/AsarSwapReplay.scratch.test.ts, run
// `pnpm vp test run packages/cli/src/AsarSwapReplay.scratch.test.ts --silent=false`, then delete
// the copy. Change `fault.current` to replay another path. A finding that is fixed makes its
// test fail. That is expected, so update or remove the test.
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import { describe, expect, it } from "vite-plus/test";

import { homeLayout } from "@t3mode/shared/Layout";

import * as AsarArchive from "./Asar.ts";
import * as Install from "./Install.ts";
import type { Target } from "./Target.ts";

type Fault = { method: "copy" | "rename"; from: (path: string) => boolean };

const busy = (method: string, path: string) =>
  PlatformError.systemError({ _tag: "Busy", module: "FileSystem", method, pathOrDescriptor: path });

/** True once, for the first call that matches the armed fault. */
const hit = (fault: { current: Fault | undefined }, method: Fault["method"], from: string) => {
  const f = fault.current;
  if (f && f.method === method && f.from(from)) {
    fault.current = undefined;
    return true;
  }
  return false;
};

const faultyFs = (fault: { current: Fault | undefined }) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return {
        ...fs,
        copy: (from: string, to: string, options?: FileSystem.CopyOptions) =>
          hit(fault, "copy", from) ? Effect.fail(busy("copy", from)) : fs.copy(from, to, options),
        rename: (from: string, to: string) =>
          hit(fault, "rename", from) ? Effect.fail(busy("rename", from)) : fs.rename(from, to),
      } satisfies FileSystem.FileSystem;
    }),
  ).pipe(Layer.provide(NodeServices.layer));

const setup = (fault: { current: Fault | undefined }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const asar = yield* AsarArchive.AsarArchive;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3mode-replay-" });
    const resources = path.join(root, "app", "resources");
    yield* fs.makeDirectory(path.join(resources, "app.asar.unpacked"), { recursive: true });
    yield* fs.writeFileString(path.join(resources, "app.asar.unpacked", "native.node"), "native");
    const source = path.join(root, "orig-src");
    yield* fs.makeDirectory(source);
    yield* fs.writeFileString(
      path.join(source, "package.json"),
      `{"name":"t3code","version":"1.0.0","main":"boot.cjs"}`,
    );
    yield* asar.pack(source, path.join(resources, "app.asar"));
    const shimEntry = path.join(root, "shim.cjs");
    yield* fs.writeFileString(shimEntry, "// shim");
    const target: Target = {
      installDir: path.join(root, "app"),
      resourcesDir: resources,
      exe: path.join(root, "app", "T3 Code.exe"),
      home: homeLayout(path.join(root, "home")),
    };
    const files = Effect.gen(function* () {
      return {
        app: yield* fs.exists(path.join(resources, "app.asar")),
        orig: yield* fs.exists(path.join(resources, "_app.asar")),
      };
    });
    return { target, shimEntry, files, fault };
  });

const run = <A, E>(
  fault: { current: Fault | undefined },
  body: (s: Effect.Success<ReturnType<typeof setup>>) => Effect.Effect<A, E, never>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const s = yield* setup(fault);
      return yield* body(s);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        AsarArchive.layer.pipe(
          Layer.provideMerge(faultyFs(fault)),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );

describe("AsarSwap findings, replayed", () => {
  it("F1: fs.copy of app.asar.unpacked fails -> app.asar missing, repair and uninstall refuse", () => {
    const fault = { current: undefined as Fault | undefined };
    return run(fault, ({ target, shimEntry, files }) =>
      Effect.gen(function* () {
        fault.current = { method: "copy", from: (p) => p.endsWith("app.asar.unpacked") };
        const first = yield* Effect.flip(Install.applyShim(target, shimEntry));
        console.log("F1 install error:", first.message);
        expect(yield* files).toEqual({ app: false, orig: true });
        const repair = yield* Effect.flip(Install.applyShim(target, shimEntry));
        console.log("F1 repair error:", repair.message);
        const uninstall = yield* Effect.flip(Install.removeShim(target));
        console.log("F1 uninstall error:", uninstall.message);
        expect(yield* files).toEqual({ app: false, orig: true });
      }),
    );
  });

  it("F2: uninstall's rename of _app.asar fails -> app.asar missing, nothing recovers", () => {
    const fault = { current: undefined as Fault | undefined };
    return run(fault, ({ target, shimEntry, files }) =>
      Effect.gen(function* () {
        expect(yield* Install.applyShim(target, shimEntry)).toBe("installed");
        fault.current = { method: "rename", from: (p) => p.endsWith("_app.asar") };
        const first = yield* Effect.flip(Install.removeShim(target));
        console.log("F2 uninstall error:", first.message);
        expect(yield* files).toEqual({ app: false, orig: true });
        const again = yield* Effect.flip(Install.removeShim(target));
        console.log("F2 uninstall again:", again.message);
        const repair = yield* Effect.flip(Install.applyShim(target, shimEntry));
        console.log("F2 repair error:", repair.message);
      }),
    );
  });

  it("control: a failed final rename is rolled back (the catch works)", () => {
    const fault = { current: undefined as Fault | undefined };
    return run(fault, ({ target, shimEntry, files }) =>
      Effect.gen(function* () {
        fault.current = { method: "rename", from: (p) => p.endsWith("app.asar.t3mode-next") };
        yield* Effect.flip(Install.applyShim(target, shimEntry));
        expect(yield* files).toEqual({ app: true, orig: false });
      }),
    );
  });
});
