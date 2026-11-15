// Reading T3 Code's update feed, the way electron-updater does: `app-update.yml` in T3 Code's
// resources names the GitHub repo and the publisher, each release carries `<channel>.yml`, and
// that file lists the installers with their SHA-512. Pure functions, so they are unit tested.
import { compareVersions, parseVersion } from "./Semver.ts";

export type YamlValue =
  | string
  | ReadonlyArray<string>
  | ReadonlyArray<Readonly<Record<string, string>>>;

const unquote = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

/**
 * The YAML electron-builder writes: top-level `key: value`, lists of scalars (`- value`) and
 * lists of flat mappings (`- url: …` then indented `sha512: …`). Nothing more.
 */
export const parseUpdateYaml = (text: string): Readonly<Record<string, YamlValue>> => {
  const result: Record<string, YamlValue> = {};
  let listKey: string | undefined;
  let scalars: Array<string> = [];
  let mappings: Array<Record<string, string>> = [];
  let current: Record<string, string> | undefined;

  const flush = () => {
    if (listKey !== undefined) result[listKey] = mappings.length > 0 ? mappings : scalars;
    listKey = undefined;
    scalars = [];
    mappings = [];
    current = undefined;
  };

  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const line = raw.trim();
    if (!/^\s/.test(raw)) {
      flush();
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      const key = line.slice(0, colon).trim();
      const value = line.slice(colon + 1);
      if (value.trim() === "") listKey = key;
      else result[key] = unquote(value);
      continue;
    }
    if (listKey === undefined) continue;
    if (line.startsWith("- ")) {
      const item = line.slice(2);
      const colon = item.indexOf(": ");
      if (colon > 0) {
        current = { [item.slice(0, colon).trim()]: unquote(item.slice(colon + 2)) };
        mappings.push(current);
      } else {
        scalars.push(unquote(item));
      }
      continue;
    }
    const colon = line.indexOf(":");
    if (current && colon > 0) current[line.slice(0, colon).trim()] = unquote(line.slice(colon + 1));
  }
  flush();
  return result;
};

const stringOf = (value: YamlValue | undefined): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

export interface AppUpdateConfig {
  readonly owner: string;
  readonly repo: string;
  readonly publisherNames: ReadonlyArray<string>;
}

/** `resources/app-update.yml`. Undefined unless it names a GitHub repo. */
export const parseAppUpdateConfig = (text: string): AppUpdateConfig | undefined => {
  const yaml = parseUpdateYaml(text);
  const owner = stringOf(yaml["owner"]);
  const repo = stringOf(yaml["repo"]);
  if (yaml["provider"] !== "github" || !owner || !repo) return undefined;
  const publisher = yaml["publisherName"];
  const publisherNames =
    typeof publisher === "string"
      ? [publisher]
      : Array.isArray(publisher)
        ? publisher.filter((name): name is string => typeof name === "string")
        : [];
  return { owner, repo, publisherNames };
};

export interface UpdateFile {
  readonly url: string;
  readonly sha512: string;
  readonly size: number;
}

export interface ChannelInfo {
  readonly version: string;
  readonly files: ReadonlyArray<UpdateFile>;
}

/** `<channel>.yml` from a release. */
export const parseChannelInfo = (text: string): ChannelInfo | undefined => {
  const yaml = parseUpdateYaml(text);
  const version = stringOf(yaml["version"]);
  const files = yaml["files"];
  if (!version || !Array.isArray(files)) return undefined;
  const parsed: Array<UpdateFile> = [];
  for (const entry of files as ReadonlyArray<unknown>) {
    if (typeof entry !== "object" || entry === null) continue;
    const fields = entry as Readonly<Record<string, string>>;
    const size = Number(fields["size"]);
    if (fields["url"] && fields["sha512"] && Number.isFinite(size) && size > 0) {
      parsed.push({ url: fields["url"], sha512: fields["sha512"], size });
    }
  }
  return { version, files: parsed };
};

/** T3 Code's channel: its own setting, else "nightly" for nightly builds, like T3 Code decides. */
export const resolveChannel = (configured: unknown, appVersion: string): string =>
  configured === "nightly" || configured === "latest"
    ? configured
    : appVersion.includes("nightly")
      ? "nightly"
      : "latest";

export interface ReleaseAsset {
  readonly name: string;
  readonly browser_download_url: string;
}

export interface Release {
  readonly tag_name: string;
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly assets: ReadonlyArray<ReleaseAsset>;
}

export interface PickedRelease {
  readonly release: Release;
  readonly channelFileUrl: string;
}

/** The newest release on the channel, and the URL of its `<channel>.yml`. */
export const pickRelease = (
  releases: ReadonlyArray<Release>,
  channel: string,
): PickedRelease | undefined => {
  let best: PickedRelease | undefined;
  for (const release of releases) {
    if (release.draft || (channel === "latest" && release.prerelease)) continue;
    if (!parseVersion(release.tag_name)) continue;
    const asset = release.assets.find((candidate) => candidate.name === `${channel}.yml`);
    if (!asset) continue;
    if (!best || compareVersions(release.tag_name, best.release.tag_name) > 0) {
      best = { release, channelFileUrl: asset.browser_download_url };
    }
  }
  return best;
};

/** The Windows installer for this CPU: electron-builder names them `…-x64.exe` and `…-arm64.exe`. */
export const pickInstaller = (
  files: ReadonlyArray<UpdateFile>,
  arch: string,
): UpdateFile | undefined => {
  const installers = files.filter((file) => file.url.toLowerCase().endsWith(".exe"));
  return (
    installers.find((file) => file.url.toLowerCase().endsWith(`-${arch.toLowerCase()}.exe`)) ??
    (installers.length === 1 && arch === "x64" ? installers[0] : undefined)
  );
};

/** The common name in a certificate subject such as `CN=T3 Tools Inc, O=T3 Tools Inc, …`. */
export const commonName = (subject: string): string | undefined => {
  const match = /(?:^|,)\s*CN=(?:"([^"]*)"|([^,]*))/.exec(subject);
  return (match?.[1] ?? match?.[2])?.trim();
};

/**
 * Why an Authenticode result is not acceptable, or undefined when it is: the signature must be
 * valid (status 0) and the signer's common name one of T3 Code's publishers (app-update.yml).
 */
export const signatureRejection = (
  status: number,
  subject: string | null,
  publishers: ReadonlyArray<string>,
): string | undefined => {
  const signer = subject ? commonName(subject) : undefined;
  if (status === 0 && signer && publishers.includes(signer)) return undefined;
  const expected = publishers.join(" or ");
  return status !== 0 || !signer
    ? `The installer has no valid signature (expected ${expected}).`
    : `The installer is signed by ${signer}, not ${expected}.`;
};
