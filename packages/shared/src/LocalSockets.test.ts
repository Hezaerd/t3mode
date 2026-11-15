import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import { ManifestSchema } from "./PluginStore.ts";
import { socketAllowed } from "./Plugins.ts";

it("validates every declared socket pattern", () => {
  const manifest = { id: "test", name: "Test", version: "1.0.0", description: "", api: 1 };
  const decode = Schema.decodeUnknownSync(ManifestSchema);
  for (const name of ["discord-ipc-*", "exact", "a.b_0-", "a".repeat(100) + "*"])
    expect(decode({ ...manifest, sockets: [name] }).sockets).toEqual([name]);
  for (const name of [
    "",
    "*",
    "..",
    ".*",
    "-x",
    "bad/name",
    "bad\\name",
    "bad name",
    "a**",
    "a*b",
    "a".repeat(101),
  ])
    expect(() => decode({ ...manifest, sockets: ["valid", name] })).toThrow();
  expect(decode(manifest).sockets).toBeUndefined();
});

it("matches exact socket names and trailing prefixes without allowing paths", () => {
  expect(socketAllowed(["exact", "discord-ipc-*"], "exact")).toBe(true);
  expect(socketAllowed(["exact", "discord-ipc-*"], "discord-ipc-0")).toBe(true);
  for (const name of ["Exact", "exact-extra", "discord-ipc", "discord-ipc-../x", ""])
    expect(socketAllowed(["exact", "discord-ipc-*"], name)).toBe(false);
  expect(socketAllowed([], "exact")).toBe(false);
});
