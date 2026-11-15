import { describe, expect, it } from "vite-plus/test";

import { compareVersions } from "./Semver.ts";
import {
  commonName,
  parseAppUpdateConfig,
  parseChannelInfo,
  pickInstaller,
  pickRelease,
  type Release,
  resolveChannel,
  signatureRejection,
} from "./UpdateFeed.ts";

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

const APP_UPDATE = [
  "owner: pingdotgg",
  "repo: t3code",
  "provider: github",
  "releaseType: prerelease",
  "channel: nightly",
  "updaterCacheDirName: t3code-updater",
  "publisherName:",
  "  - T3 Tools Inc",
  "",
].join("\n");

const NIGHTLY = [
  "version: '0.1.10-nightly.20261114.4709'",
  "files:",
  "  - url: T3-Code-0.1.10-nightly.20261114.4709-x64.exe",
  "    sha512: RKxXIhWzGnxJde84dnMDTNbG1k3FeiNMlWlaLOR0AoYP+XATyeEKOEVk7Nh/cjdUFt0V6wEUziBV57Ddg9tJew==",
  "    size: 389901128",
  "  - url: T3-Code-0.1.10-nightly.20261114.4709-arm64.exe",
  "    sha512: pY/M1FXmoF9hr8PG8UJsag1eT+lBk7OLk4qfPQlQYCGY9r1k4lZWGgn9Ei0mwB0af3lDjKzbZXNXydumedfmfA==",
  "    size: 362475520",
  "releaseDate: '2026-11-14T23:16:19.149Z'",
  "",
].join("\r\n");

describe("update feed files", () => {
  it("reads app-update.yml", () => {
    expect(parseAppUpdateConfig(APP_UPDATE)).toEqual({
      owner: "pingdotgg",
      repo: "t3code",
      publisherNames: ["T3 Tools Inc"],
    });
    expect(parseAppUpdateConfig("provider: generic\nurl: https://example.com\n")).toBeUndefined();
  });

  it("reads the channel file and picks the installer for the CPU", () => {
    const info = parseChannelInfo(NIGHTLY);
    expect(info?.version).toBe("0.1.10-nightly.20261114.4709");
    expect(info?.files).toHaveLength(2);
    const files = info?.files ?? [];
    expect(pickInstaller(files, "x64")?.size).toBe(389901128);
    expect(pickInstaller(files, "x64")?.sha512).toMatch(/^RKxX.*==$/);
    expect(pickInstaller(files, "arm64")?.url).toBe(
      "T3-Code-0.1.10-nightly.20261114.4709-arm64.exe",
    );
    expect(pickInstaller(files, "ia32")).toBeUndefined();
    expect(parseChannelInfo("version: 1.0.0\n")).toBeUndefined();
  });

  it("follows T3 Code's channel setting, else the build's own channel", () => {
    expect(resolveChannel("latest", "0.1.10-nightly.20261114.4669")).toBe("latest");
    expect(resolveChannel(undefined, "0.1.10-nightly.20261114.4669")).toBe("nightly");
    expect(resolveChannel("bogus", "0.1.9")).toBe("latest");
  });

  it("reads the common name of a certificate subject", () => {
    expect(commonName("CN=T3 Tools Inc, O=T3 Tools Inc, L=San Fransisco, C=US")).toBe(
      "T3 Tools Inc",
    );
    expect(commonName('O=Other, CN="Quoted, Inc"')).toBe("Quoted, Inc");
    expect(commonName("O=No common name")).toBeUndefined();
  });
});

const release = (tag: string, prerelease: boolean, files: ReadonlyArray<string>): Release => ({
  tag_name: tag,
  draft: false,
  prerelease,
  assets: files.map((name) => ({ name, browser_download_url: `https://x/${tag}/${name}` })),
});

describe("pickRelease", () => {
  const releases = [
    release("v0.1.10-nightly.20261114.4682", true, ["nightly.yml"]),
    release("v0.1.10-nightly.20261114.4709", true, ["nightly.yml"]),
    { ...release("v0.1.10-nightly.20261115.4720", true, ["nightly.yml"]), draft: true },
    release("v0.1.9", false, ["latest.yml"]),
    release("v0.1.10-nightly.20261114.4699", true, []),
  ];

  it("picks the newest release that has the channel file", () => {
    expect(pickRelease(releases, "nightly")?.channelFileUrl).toBe(
      "https://x/v0.1.10-nightly.20261114.4709/nightly.yml",
    );
    expect(pickRelease(releases, "latest")?.release.tag_name).toBe("v0.1.9");
    expect(pickRelease([], "nightly")).toBeUndefined();
  });
});

describe("signatureRejection", () => {
  const publishers = ["T3 Tools Inc"];
  it("accepts a valid signature from T3 Code's publisher only", () => {
    expect(
      signatureRejection(0, "CN=T3 Tools Inc, O=T3 Tools Inc, L=San Fransisco, C=US", publishers),
    ).toBeUndefined();
    expect(signatureRejection(1, null, publishers)).toMatch(/no valid signature/);
    expect(signatureRejection(2, "CN=T3 Tools Inc", publishers)).toMatch(/no valid signature/);
    expect(signatureRejection(0, "CN=Microsoft Windows, O=Microsoft Corporation", publishers)).toBe(
      "The installer is signed by Microsoft Windows, not T3 Tools Inc.",
    );
  });
});
