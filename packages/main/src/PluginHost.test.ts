import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import type { PluginAction } from "@t3mode/shared/Ipc";

import { PluginActionSchema } from "./PluginHost.ts";

const decode = Schema.decodeUnknownSync(PluginActionSchema);

describe("PluginActionSchema", () => {
  it("accepts the Plugins page's actions", () => {
    const actions: ReadonlyArray<PluginAction> = [
      { _tag: "list" },
      { _tag: "preview", input: "owner/repo" },
      {
        _tag: "install",
        source: { kind: "github", owner: "owner", repo: "repo", tag: "v1.0.0" },
        id: "my-plugin",
      },
      { _tag: "update", id: "my-plugin" },
      { _tag: "remove", id: "my-plugin" },
      { _tag: "check" },
    ];
    for (const action of actions) expect(decode(action)).toEqual(action);
  });

  it("refuses a local source, so page code can't make main read a folder", () => {
    expect(() =>
      decode({ _tag: "install", source: { kind: "local", path: "C:/Users" }, id: "my-plugin" }),
    ).toThrow();
  });

  it("refuses ids and GitHub names that aren't safe", () => {
    for (const action of [
      { _tag: "remove", id: "../../Users" },
      { _tag: "update", id: "My Plugin" },
      { _tag: "install", source: { kind: "github", owner: "../x", repo: "repo" }, id: "a" },
      { _tag: "install", source: { kind: "github", owner: "o", repo: "r", tag: "../x" }, id: "a" },
      { _tag: "link", path: "C:/dev" },
    ]) {
      expect(() => decode(action), JSON.stringify(action)).toThrow();
    }
  });
});
