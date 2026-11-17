// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { openBackendLog } from "./BackendLog.ts";

const dirs: Array<string> = [];
const tempDir = () => {
  const dir = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "t3mode-backend-log-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) NodeFs.rmSync(dir, { recursive: true, force: true });
});

const read = (file: string) => (NodeFs.existsSync(file) ? NodeFs.readFileSync(file, "utf8") : "");

describe("openBackendLog", () => {
  it("rotates to <id>.old.log while it writes, so the logs stay bounded", () => {
    const dir = tempDir();
    const log = openBackendLog(dir, "demo", { maxBytes: 300 });
    // Each line is about 60 bytes with its timestamp.
    for (let i = 0; i < 100; i++) log.write(`line ${String(i).padStart(3, "0")} ${"x".repeat(20)}`);
    log.close();
    const current = NodePath.join(dir, "demo.log");
    const old = NodePath.join(dir, "demo.old.log");
    expect(NodeFs.statSync(current).size).toBeLessThanOrEqual(300);
    expect(NodeFs.statSync(old).size).toBeLessThanOrEqual(300);
    expect(read(current)).toContain("line 099");
    // The old log holds the lines just before the current one's.
    const firstCurrent = Number(/line (\d+)/.exec(read(current))![1]);
    expect(read(old).trimEnd().split("\n").at(-1)).toContain(
      `line ${String(firstCurrent - 1).padStart(3, "0")}`,
    );
  });

  it("appends to an existing log, and rotates one already over the limit on its first line", () => {
    const dir = tempDir();
    const current = NodePath.join(dir, "demo.log");
    NodeFs.writeFileSync(current, "kept\n");
    const small = openBackendLog(dir, "demo", { maxBytes: 300 });
    small.write("appended");
    small.close();
    expect(read(current)).toMatch(/^kept\n.* appended\n$/);

    NodeFs.writeFileSync(current, "y".repeat(400));
    const big = openBackendLog(dir, "demo", { maxBytes: 300 });
    big.write("fresh");
    big.close();
    expect(read(NodePath.join(dir, "demo.old.log"))).toBe("y".repeat(400));
    expect(read(current)).toMatch(/^\S+ fresh\n$/);
  });

  it("writes the lines of one turn with one call", () => {
    const dir = tempDir();
    const flushes: Array<() => void> = [];
    const appends: Array<string> = [];
    const log = openBackendLog(dir, "demo", {
      schedule: (flush) => flushes.push(flush),
      append: (fd, text) => {
        appends.push(text);
        NodeFs.writeSync(fd, text);
      },
    });
    for (let i = 0; i < 1000; i++) log.write(`line ${i}`);
    expect(appends).toHaveLength(0);
    expect(flushes).toHaveLength(1);
    flushes[0]!();
    expect(appends).toHaveLength(1);
    expect(appends[0]!.split("\n")).toHaveLength(1001);

    log.write("exited");
    log.flush();
    expect(appends).toHaveLength(2);
    expect(appends[1]).toMatch(/ exited\n$/);

    log.write("next turn");
    expect(flushes).toHaveLength(3);
    log.close();
    expect(appends).toHaveLength(3);
    expect(read(NodePath.join(dir, "demo.log")).trimEnd().split("\n")).toHaveLength(1002);
  });

  it("flushes after the current turn by default", async () => {
    const dir = tempDir();
    const log = openBackendLog(dir, "demo");
    log.write("later");
    expect(read(NodePath.join(dir, "demo.log"))).toBe("");
    await new Promise((resolve) => setImmediate(resolve));
    expect(read(NodePath.join(dir, "demo.log"))).toMatch(/ later\n$/);
    log.close();
  });

  it("drops lines after close and creates its folder", () => {
    const dir = NodePath.join(tempDir(), "logs", "plugins");
    const log = openBackendLog(dir, "demo");
    log.write("one");
    log.close();
    log.write("two");
    expect(read(NodePath.join(dir, "demo.log"))).toMatch(/one\n$/);
  });
});
