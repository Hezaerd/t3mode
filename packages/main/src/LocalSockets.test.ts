// @effect-diagnostics nodeBuiltinImport:off
import * as Net from "node:net";
import { EventEmitter, once } from "node:events";
import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { expect, it, vi } from "vite-plus/test";
import { makeRegistry, SocketActionSchema } from "./LocalSockets.ts";
import * as Schema from "effect/Schema";

const owner = () => Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn() });
const plugin = {
  id: "test",
  name: "Test",
  version: "1.0.0",
  description: "",
  source: { kind: "local" as const, path: "test" },
  sockets: ["t3mode-test-*"],
};

it("refuses malformed actions at the boundary", () => {
  const decode = Schema.decodeUnknownSync(SocketActionSchema);
  for (const value of [
    { _tag: "connect", plugin: "test", name: "../pipe" },
    { _tag: "write", id: 1, data: [1] },
    { _tag: "close", id: -1 },
  ])
    expect(() => decode(value)).toThrow();
});

it
  .skipIf(process.platform !== "win32")
  .each(["did-start-navigation", "render-process-gone", "destroyed"])(
  "exchanges pipe bytes and closes on %s",
  async (event) => {
    const name = `t3mode-test-${randomUUID()}`;
    const server = Net.createServer();
    server.listen("\\\\.\\pipe\\" + name);
    await once(server, "listening");
    const registry = makeRegistry();
    const page = owner();
    const web = page as unknown as WebContents;
    try {
      expect(await registry.connect(web, plugin, "undeclared")).toMatchObject({ ok: false });
      const accepted = once(server, "connection");
      const result = await registry.connect(web, plugin, name);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      const [peer] = (await accepted) as [Net.Socket];
      const data = once(peer, "data");
      registry.write(web, result.value, new Uint8Array([1, 2, 3]));
      expect(new Uint8Array((await data)[0])).toEqual(new Uint8Array([1, 2, 3]));
      peer.write(new Uint8Array([4, 5]));
      await vi.waitFor(() =>
        expect(page.send).toHaveBeenCalledWith("t3mode:socket-event", {
          _tag: "data",
          id: result.value,
          data: new Uint8Array([4, 5]),
        }),
      );
      expect(() =>
        registry.write(owner() as unknown as WebContents, result.value, new Uint8Array()),
      ).toThrow("Unknown");
      expect(() => registry.write(web, result.value, new Uint8Array(1024 * 1024 + 1))).toThrow(
        "1 MiB",
      );
      const closed = once(peer, "close");
      page.emit(event, {}, "t3code://app/", false, true);
      await closed;
      expect(() => registry.write(web, result.value, new Uint8Array())).toThrow("Unknown");
      expect(page.listenerCount("did-start-navigation")).toBe(0);
    } finally {
      server.close();
    }
  },
);

it.skipIf(process.platform !== "win32")(
  "reports absent listeners and enforces the eight-connection limit",
  async () => {
    const registry = makeRegistry();
    const page = owner();
    const web = page as unknown as WebContents;
    const name = `t3mode-test-${randomUUID()}`;
    expect(await registry.connect(web, plugin, name)).toEqual({
      ok: false,
      error: `Nothing is listening on ${name}.`,
    });
    const server = Net.createServer((socket) => socket.resume());
    server.listen("\\\\.\\pipe\\" + name);
    await once(server, "listening");
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => registry.connect(web, plugin, name)),
      );
      expect(results.every((result) => result.ok)).toBe(true);
      expect(await registry.connect(web, plugin, name)).toEqual({
        ok: false,
        error: "This plugin already has 8 local sockets open.",
      });
      page.emit("destroyed");
    } finally {
      server.close();
    }
  },
);
