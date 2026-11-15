import { describe, expect, it, vi } from "vite-plus/test";
import type { PluginData } from "@t3mode/shared/Plugins";
import { pluginStorage } from "./PluginStorage.ts";

const deferred = () => Promise.withResolvers<void>();
const path = (id: string) => `home/plugin-data/${id}.json`;

describe("pluginStorage", () => {
  it("coalesces calls during a write and persists the latest record", async () => {
    const first = deferred();
    const write = vi
      .fn<(id: string, record: PluginData) => Promise<void>>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const manager = pluginStorage(new Map(), [], path, write, vi.fn());
    const storage = manager.storage("example");
    storage.set("count", 0);
    for (let n = 1; n <= 100; n++) storage.set("count", n);
    storage.set("other", true);
    expect(storage.get("count", -1)).toBe(100);
    expect(write).toHaveBeenCalledTimes(1);
    let flushed = false;
    const flushing = manager.flush("example").then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    first.resolve();
    await flushing;
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]).toEqual(["example", { count: 100, other: true }]);
  });
  it("normalizes and isolates values and uses own keys for fallback", () => {
    const warn = vi.fn();
    const storage = pluginStorage(
      new Map(),
      [],
      path,
      vi.fn().mockResolvedValue(undefined),
      warn,
    ).storage("example");
    expect(storage.get("constructor", "fallback")).toBe("fallback");
    const value = { list: [1], missing: undefined };
    storage.set("value", value);
    value.list.push(2);
    const result = storage.get("value", { list: [] as number[] });
    expect(result).toEqual({ list: [1] });
    result.list.push(3);
    expect(storage.get("value", null)).toEqual({ list: [1] });
    storage.set("__proto__", 42);
    expect(storage.get("__proto__", 0)).toBe(42);
    storage.set("value", undefined);
    storage.set("big", 1n);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(storage.get("value", null)).toEqual({ list: [1] });
  });
  it("keeps memory after failure and continues with queued writes", async () => {
    const first = deferred();
    const warn = vi.fn();
    const write = vi
      .fn<(id: string, record: PluginData) => Promise<void>>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const storage = pluginStorage(new Map(), [], path, write, warn).storage("example");
    storage.set("value", 1);
    storage.set("value", 2);
    first.reject(new Error("disk full"));
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not store"));
    expect(storage.get("value", 0)).toBe(2);
    expect(write.mock.calls[1]).toEqual(["example", { value: 2 }]);
    storage.set("value", 3);
    expect(write).toHaveBeenCalledTimes(3);
  });
  it("stores nothing for a plugin whose file is unreadable", () => {
    const warn = vi.fn();
    const write = vi.fn().mockResolvedValue(undefined);
    const manager = pluginStorage(new Map(), ["broken"], path, write, warn);
    const broken = manager.storage("broken");
    expect(broken.readable).toBe(false);
    expect(broken.path).toBe("home/plugin-data/broken.json");
    broken.set("value", 1);
    broken.set("value", 2);
    expect(broken.get("value", 0)).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const fine = manager.storage("fine");
    expect(fine.readable).toBe(true);
    fine.set("value", 1);
    expect(write).toHaveBeenCalledWith("fine", { value: 1 });
    manager.forget("broken");
    const reinstalled = manager.storage("broken");
    expect(reinstalled.readable).toBe(true);
    reinstalled.set("value", 3);
    expect(write).toHaveBeenCalledWith("broken", { value: 3 });
  });
});
