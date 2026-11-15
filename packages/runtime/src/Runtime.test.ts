import { afterEach, expect, it, vi } from "vite-plus/test";
import type { PluginApi } from "@t3mode/plugin-sdk";
import type { NativeBridge } from "@t3mode/shared/Ipc";
import { Runtime } from "./Runtime.ts";

afterEach(() => vi.unstubAllGlobals());

it("finishes writes from running plugins and cleanup before removing their data", async () => {
  const first = Promise.withResolvers<void>();
  const write = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValue(undefined);
  const remove = vi.fn().mockResolvedValue({ ok: true, value: "removed" });
  vi.stubGlobal("window", {
    __t3modePlugins: [
      {
        id: "example",
        load: () => ({
          options: {},
          start(api: PluginApi) {
            expect(api.storage.get("saved", false)).toBe(true);
            api.storage.set("count", 1);
            api.onCleanup(() => api.storage.set("count", 2));
          },
        }),
      },
    ],
  });
  const runtime = new Runtime(
    {
      writePluginData: write,
      plugins: { remove },
      log: vi.fn().mockResolvedValue(undefined),
    } as unknown as NativeBridge,
    [
      {
        id: "example",
        name: "Example",
        description: "",
        version: "1.0.0",
        source: { kind: "local", path: "example" },
      },
    ],
    { version: 1, plugins: {} },
    { t3modeVersion: "1", t3codeVersion: "1", home: "home", logs: "logs", safeMode: false },
    { data: { example: { saved: true } }, unreadable: [] },
  );
  runtime.startAll();
  const removal = runtime.remove("example");
  expect(remove).not.toHaveBeenCalled();
  first.resolve();
  expect(await removal).toEqual({ ok: true, value: "removed" });
  expect(write.mock.calls).toEqual([
    ["example", { saved: true, count: 1 }],
    ["example", { saved: true, count: 2 }],
  ]);
  expect(remove).toHaveBeenCalledWith("example");
  expect(runtime.plugins).toEqual([]);
});
