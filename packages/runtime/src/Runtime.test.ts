import { afterEach, expect, it, vi } from "vite-plus/test";
import type { PluginApi } from "@t3mode/plugin-sdk";
import type { BackendEvent } from "@t3mode/shared/Backends";
import type { NativeBridge } from "@t3mode/shared/Ipc";
import { Runtime } from "./Runtime.ts";

vi.mock("./ui/toast.ts", () => ({ toast: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

/** The backend half of the bridge, for tests that don't use it. */
const noBackends = {
  backend: vi.fn().mockResolvedValue(true),
  onBackendEvent: () => undefined,
};

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
      ...noBackends,
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

it("shows a plugin's settings panel while it runs and stops a panel that throws", async () => {
  const render = vi.fn<(host: HTMLElement) => void>(() => {
    throw new Error("broken panel");
  });
  vi.stubGlobal("window", {
    __t3modePlugins: [
      {
        id: "example",
        load: () => ({
          options: {},
          start(api: PluginApi) {
            api.settingsPanel("Example", render);
          },
        }),
      },
    ],
  });
  const runtime = new Runtime(
    {
      ...noBackends,
      writeSettings: vi.fn().mockResolvedValue(undefined),
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
    { data: {}, unreadable: [] },
  );
  runtime.startAll();
  expect(runtime.panel("example")?.title).toBe("Example");
  await runtime.setEnabled("example", false);
  expect(runtime.panel("example")).toBeUndefined();
  await runtime.setEnabled("example", true);
  runtime.panel("example")?.render({} as HTMLElement);
  expect(render).toHaveBeenCalledTimes(1);
  expect(runtime.state("example").kind).toBe("failed");
  expect(runtime.panel("example")).toBeUndefined();
});

it("rejects a local socket connect, now that the transport is gone", async () => {
  let api: PluginApi | undefined;
  vi.stubGlobal("window", {
    __t3modePlugins: [
      {
        id: "example",
        load: () => ({
          options: {},
          start: (started: PluginApi) => {
            api = started;
          },
        }),
      },
    ],
  });
  const runtime = new Runtime(
    { ...noBackends, log: vi.fn().mockResolvedValue(undefined) } as unknown as NativeBridge,
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
    { data: {}, unreadable: [] },
  );
  runtime.startAll();
  await expect(api?.sockets.connect("probe")).rejects.toThrow("Use a backend instead");
  expect(runtime.state("example")).toEqual({ kind: "running", report: null });
});

it("carries backend messages for the plugin's own id and drops its listeners when it stops", async () => {
  let deliver: ((event: BackendEvent) => void) | undefined;
  const backend = vi.fn().mockResolvedValue(true);
  const messages: Array<unknown> = [];
  const statuses: Array<unknown> = [];
  let api: PluginApi | undefined;
  vi.stubGlobal("window", {
    __t3modePlugins: [
      {
        id: "example",
        load: () => ({
          options: {},
          start: (started: PluginApi) => {
            api = started;
            started.backend?.onMessage((data) => messages.push(data));
            started.backend?.onStatus((status) => statuses.push(status));
          },
        }),
      },
    ],
  });
  const runtime = new Runtime(
    {
      backend,
      onBackendEvent: (listener: (event: BackendEvent) => void) => {
        deliver = listener;
      },
      writeSettings: vi.fn().mockResolvedValue(undefined),
      log: vi.fn().mockResolvedValue(undefined),
    } as unknown as NativeBridge,
    [
      {
        id: "example",
        name: "Example",
        description: "",
        version: "1.0.0",
        source: { kind: "github", owner: "o", repo: "r" },
      },
    ],
    { version: 1, plugins: {} },
    { t3modeVersion: "0", t3codeVersion: "0", home: "C:\\home", logs: "", safeMode: false },
    { data: {}, unreadable: [] },
  );
  deliver?.({ _tag: "status", plugin: "example", status: { state: "starting" } });
  expect(deliver).toBeUndefined();
  await runtime.followBackends();
  expect(backend).toHaveBeenCalledWith({ _tag: "subscribe" });
  deliver?.({ _tag: "status", plugin: "example", status: { state: "starting" } });
  runtime.startAll();

  expect(await api?.backend?.send({ ping: 1 })).toBe(true);
  expect(backend).toHaveBeenLastCalledWith({ _tag: "send", plugin: "example", data: { ping: 1 } });
  deliver?.({ _tag: "message", plugin: "example", data: "pong" });
  deliver?.({ _tag: "message", plugin: "other", data: "not mine" });
  deliver?.({ _tag: "status", plugin: "example", status: { state: "running" } });
  expect(messages).toEqual(["pong"]);
  expect(statuses).toEqual([{ state: "starting" }, { state: "running" }]);
  expect(runtime.backendStatus("example")).toEqual({ state: "running" });

  await runtime.setEnabled("example", false);
  deliver?.({ _tag: "message", plugin: "example", data: "after stop" });
  expect(messages).toEqual(["pong"]);
  backend.mockClear();
  expect(await api?.backend?.send("late")).toBe(false);
  expect(backend).not.toHaveBeenCalled();
});
