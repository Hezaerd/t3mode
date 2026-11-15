// @effect-diagnostics nodeBuiltinImport:off
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { homeLayout } from "@t3mode/shared/Layout";
import * as Files from "./Files.ts";
import { Home } from "./Home.ts";
import * as PluginDataStore from "./PluginDataStore.ts";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "t3mode-data-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const run = <A, E>(
  body: (store: PluginDataStore.PluginDataStore["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* body(yield* PluginDataStore.PluginDataStore);
    }).pipe(
      Effect.provide(
        PluginDataStore.layer.pipe(
          Layer.provide(
            Layer.mergeAll(Files.layer, Layer.succeed(Home, { layout: homeLayout(root) })),
          ),
        ),
      ),
    ),
  );

describe("PluginDataStore", () => {
  it("reads an absent folder as empty without creating it", async () => {
    expect(await run((store) => store.read)).toEqual({ data: {}, unreadable: [] });
    expect(fs.existsSync(homeLayout(root).pluginData)).toBe(false);
  });
  it("round trips JSON records and replaces the previous record", () =>
    run((store) =>
      Effect.gen(function* () {
        const data = { text: "hello", nested: { list: [1, null, true] } };
        yield* store.write("example", { old: true });
        yield* store.write("example", data);
        expect(yield* store.read).toEqual({ data: { example: data }, unreadable: [] });
        expect(
          JSON.parse(
            fs.readFileSync(path.join(homeLayout(root).pluginData, "example.json"), "utf8"),
          ),
        ).toEqual(data);
      }),
    ));
  it("names invalid and unreadable files while loading valid records", async () => {
    const folder = homeLayout(root).pluginData;
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "bad.json"), "{");
    fs.writeFileSync(path.join(folder, "array.json"), "[]");
    fs.writeFileSync(path.join(folder, "INVALID.json"), "{}");
    fs.mkdirSync(path.join(folder, "unreadable.json"));
    fs.writeFileSync(path.join(folder, "good.json"), '{"value":42}');
    const snapshot = await run((store) => store.read);
    expect(snapshot.data).toEqual({ good: { value: 42 } });
    expect(snapshot.unreadable.toSorted()).toEqual(["array", "bad", "unreadable"]);
  });
  it("refuses unsafe ids and non-record arguments", async () => {
    await Promise.all(
      ["../outside", "", "UPPER", 1].map((id) =>
        expect(run((store) => store.write(id, {}))).rejects.toThrow(),
      ),
    );
    await Promise.all(
      [null, [], "text"].map((data) =>
        expect(run((store) => store.write("example", data))).rejects.toThrow(),
      ),
    );
    expect(fs.existsSync(homeLayout(root).pluginData)).toBe(false);
  });
  it("refuses records over 1 MiB measured in UTF-8 bytes", async () => {
    await expect(
      run((store) => store.write("example", { value: "é".repeat(600_000) })),
    ).rejects.toThrow("1 MiB");
    expect(fs.existsSync(homeLayout(root).pluginData)).toBe(false);
  });
});
