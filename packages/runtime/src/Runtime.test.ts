import { afterEach, expect, it, vi } from "vite-plus/test";
import type { LocalSocket, PluginApi } from "@t3mode/plugin-sdk";
import type { BackendEvent } from "@t3mode/shared/Backends";
import type { NativeBridge, SocketEvent } from "@t3mode/shared/Ipc";
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

it("closes sockets when stopped and rejects a connect that finishes after stop", async () => {
  const pending = Promise.withResolvers<{ ok: true; value: number }>();
  const close = vi.fn().mockResolvedValue(undefined);
  let opening: Promise<unknown> = Promise.resolve();
  vi.stubGlobal("window", {
    __t3modePlugins: [
      {
        id: "example",
        load: () => ({
          options: {},
          start(api: PluginApi) {
            opening = api.sockets.connect("probe");
          },
        }),
      },
    ],
  });
  const native = {
    ...noBackends,
    socket: {
      connect: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, value: 1 })
        .mockImplementationOnce(() => pending.promise),
      close,
    },
    onSocketEvent: vi.fn(),
    writeSettings: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
  } as unknown as NativeBridge;
  const runtime = new Runtime(
    native,
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
  await opening;
  await runtime.setEnabled("example", false);
  expect(close).toHaveBeenCalledWith(1);
  await runtime.setEnabled("example", true);
  const rejected = expect(opening).rejects.toThrow("stopped while connecting");
  await runtime.setEnabled("example", false);
  pending.resolve({ ok: true, value: 2 });
  await rejected;
  expect(close).toHaveBeenCalledWith(2);
});

it("hands bytes that arrived before onData to the first data listener", async () => {
  let emit: ((event: SocketEvent) => void) | undefined;
  const reply = Promise.withResolvers<{ ok: true; value: number }>();
  let opening: Promise<LocalSocket> | undefined;
  vi.stubGlobal("window", {
    __t3modePlugins: [
      {
        id: "example",
        load: () => ({
          options: {},
          start(api: PluginApi) {
            opening = api.sockets.connect("probe");
          },
        }),
      },
    ],
  });
  const native = {
    ...noBackends,
    socket: { connect: () => reply.promise, close: vi.fn().mockResolvedValue(undefined) },
    onSocketEvent: (listener: (event: SocketEvent) => void) => {
      emit = listener;
    },
    writeSettings: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
  } as unknown as NativeBridge;
  const runtime = new Runtime(
    native,
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
  emit?.({ _tag: "data", id: 7, data: new Uint8Array([1]) });
  reply.resolve({ ok: true, value: 7 });
  const socket = await opening!;
  emit?.({ _tag: "data", id: 7, data: new Uint8Array([2]) });
  const received: Array<number> = [];
  socket.onData((data) => received.push(...data));
  emit?.({ _tag: "data", id: 7, data: new Uint8Array([3]) });
  expect(received).toEqual([1, 2, 3]);
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
