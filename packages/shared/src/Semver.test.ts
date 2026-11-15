import { describe, expect, it } from "vite-plus/test";

import { compareVersions } from "./Semver.ts";

describe("compareVersions", () => {
  it("orders T3 Code nightlies by date, then build", () => {
    expect(compareVersions("0.1.10-nightly.20261114.4709", "0.1.10-nightly.20261114.4669")).toBe(1);
    expect(compareVersions("0.1.10-nightly.20261113.4656", "0.1.10-nightly.20261114.4669")).toBe(
      -1,
    );
    expect(compareVersions("v0.1.10-nightly.20261114.4669", "0.1.10-nightly.20261114.4669")).toBe(
      0,
    );
  });

  it("puts a release after its prereleases, and compares numbers as numbers", () => {
    expect(compareVersions("0.1.10", "0.1.10-nightly.20261114.4669")).toBe(1);
    expect(compareVersions("0.1.9", "0.1.10")).toBe(-1);
    expect(compareVersions("1.0.0-beta.10", "1.0.0-beta.9")).toBe(1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareVersions("not a version", "0.0.1")).toBe(-1);
  });
});
