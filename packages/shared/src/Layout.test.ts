import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { describe, expect, it } from "vite-plus/test";

import { resolveHomeRoot } from "./Layout.ts";

const path = Effect.runSync(Path.Path.pipe(Effect.provide(NodePath.layer)));

describe("resolveHomeRoot", () => {
  it("prefers T3MODE_HOME over T3CODE_HOME", () => {
    expect(
      resolveHomeRoot({ T3MODE_HOME: " custom-mode ", T3CODE_HOME: "custom-t3" }, "user-home"),
    ).toBe("custom-mode");
  });

  it("keeps t3mode inside T3CODE_HOME", () => {
    expect(resolveHomeRoot({ T3CODE_HOME: " custom-t3 " }, "user-home")).toBe(
      path.join("custom-t3", "t3mode"),
    );
  });

  it("defaults to ~/.t3/t3mode", () => {
    expect(resolveHomeRoot({}, "user-home")).toBe(path.join("user-home", ".t3", "t3mode"));
  });

  it("ignores whitespace-only overrides", () => {
    expect(resolveHomeRoot({ T3MODE_HOME: " \t ", T3CODE_HOME: "custom-t3" }, "user-home")).toBe(
      path.join("custom-t3", "t3mode"),
    );
    expect(resolveHomeRoot({ T3MODE_HOME: " \t ", T3CODE_HOME: " \n " }, "user-home")).toBe(
      path.join("user-home", ".t3", "t3mode"),
    );
  });
});
