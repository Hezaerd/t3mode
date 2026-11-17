import { describe, expect, it } from "vite-plus/test";

import { T3MODE_VERSION } from "@t3mode/shared/Version";

import cliPackage from "../package.json" with { type: "json" };

describe("version", () => {
  it("publishes the CLI under the version that t3mode reports", () => {
    expect(cliPackage.version).toBe(T3MODE_VERSION);
  });
});
