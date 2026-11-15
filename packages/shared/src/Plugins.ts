// Standalone plugins (see "Plugins" in docs/architecture.md): what an installed plugin is, where
// its files come from, and how its code is wrapped for the page. Plain types and pure functions:
// the preload and the page runtime import this file, so it must stay free of Effect and Node.

export const PLUGIN_API_VERSION = 1;

/** A plugin id becomes a folder name, a settings key and a string in generated code. */
export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The two files of a plugin, in a GitHub release, an installed copy and a linked folder. */
export const PLUGIN_FILES = { manifest: "manifest.json", code: "plugin.js" } as const;

export const MAX_PLUGIN_CODE_BYTES = 5 * 1024 * 1024;
export const MAX_PLUGIN_MANIFEST_BYTES = 64 * 1024;

export interface Manifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author?: string;
  /** The plugin API's major version the plugin was built for. */
  readonly api: number;
}

export interface GithubSource {
  readonly kind: "github";
  readonly owner: string;
  readonly repo: string;
  /** Pinned to this release. Without it, installs and updates use the latest release. */
  readonly tag?: string;
}

/** A folder on disk, added by `plugin link` for development. Only the CLI adds these. */
export interface LocalSource {
  readonly kind: "local";
  readonly path: string;
}

export type PluginSource = GithubSource | LocalSource;

export interface LockEntry {
  readonly source: PluginSource;
  readonly version: string;
  /** Hex SHA-256 of the installed plugin.js. GitHub installs only. */
  readonly sha256?: string;
}

/** `<home>/plugins.json`. */
export interface Lockfile {
  readonly version: 1;
  readonly plugins: Readonly<Record<string, LockEntry>>;
}

/** The entry for `id`. Own keys only, so an id like "constructor" never finds Object's. */
export const lockEntry = (lock: Lockfile, id: string): LockEntry | undefined =>
  Object.hasOwn(lock.plugins, id) ? lock.plugins[id] : undefined;

export interface InstalledPlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author?: string;
  readonly source: PluginSource;
  readonly sha256?: string;
  /** Why the plugin can't be loaded. No code runs for it. */
  readonly error?: string;
  /** A newer version, known after a check for updates. */
  readonly update?: string;
}

export interface PluginPreview {
  readonly source: GithubSource;
  readonly manifest: Manifest;
}

/** The answer to a page action that can fail, with a message for the user. */
export type PluginResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: string };

/** What a wrapped plugin pushes onto `window.__t3modePlugins`. `load` runs its code. */
export interface PluginRegistration {
  readonly id: string;
  readonly load: () => unknown;
}

/** A script the preload runs in the page, named for DevTools with `//# sourceURL`. */
export interface PageScript {
  readonly name: string;
  readonly code: string;
}

/** GitHub's rules: letters, digits and inner hyphens, up to 39 characters. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const TAG = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

export const isPluginId = (value: string): boolean => PLUGIN_ID_PATTERN.test(value);
export const isGithubOwner = (value: string): boolean => OWNER.test(value);
export const isGithubRepo = (value: string): boolean =>
  REPO.test(value) && value !== "." && value !== ".." && !value.endsWith(".git");
export const isGithubTag = (value: string): boolean => TAG.test(value);

const githubSource = (owner: string, repo: string, tag: string | undefined) => {
  const name = repo.replace(/\.git$/, "");
  if (!isGithubOwner(owner) || !isGithubRepo(name)) return undefined;
  if (tag === undefined) return { kind: "github", owner, repo: name } satisfies GithubSource;
  return isGithubTag(tag)
    ? ({ kind: "github", owner, repo: name, tag } satisfies GithubSource)
    : undefined;
};

const decode = (text: string): string | undefined => {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
};

const SHORT = /^([^/@\s]+)\/([^/@\s]+?)\/?(?:@([^/@\s]+))?$/;
const URL_PREFIX = /^(?:https?:\/\/)?(?:www\.)?github\.com\//i;
const RELEASE_TAG = /^([^/]+)\/([^/]+)\/releases\/tag\/([^/?#]+)\/?$/;

/**
 * A GitHub repo from what a user pastes: `owner/repo`, `github.com/owner/repo`, the repo URL
 * (with `.git` or a trailing slash), or a release tag URL. `@tag` pins any form but the last.
 */
export const parseGithubSource = (input: string): GithubSource | undefined => {
  const text = input.trim();
  const hasPrefix = URL_PREFIX.test(text);
  const rest = text.replace(URL_PREFIX, "");
  if (hasPrefix) {
    const release = RELEASE_TAG.exec(rest);
    if (release) {
      const tag = decode(release[3]!);
      return tag === undefined ? undefined : githubSource(release[1]!, release[2]!, tag);
    }
  } else if (text.includes(":")) {
    return undefined;
  }
  const short = SHORT.exec(rest);
  return short ? githubSource(short[1]!, short[2]!, short[3]) : undefined;
};

/** A release asset: the latest release's, or the pinned tag's. */
export const releaseAssetUrl = (base: string, source: GithubSource, file: string): string => {
  const repo = `${base.replace(/\/+$/, "")}/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`;
  const release =
    source.tag === undefined
      ? "releases/latest/download"
      : `releases/download/${encodeURIComponent(source.tag)}`;
  return `${repo}/${release}/${encodeURIComponent(file)}`;
};

export const sourceLabel = (source: PluginSource): string =>
  source.kind === "github"
    ? `${source.owner}/${source.repo}${source.tag === undefined ? "" : `@${source.tag}`}`
    : `linked from ${source.path}`;

/**
 * Whether two sources are the same place, ignoring a GitHub tag: re-pinning or unpinning a repo
 * updates its install, a different repo or folder is another plugin. GitHub names ignore case.
 */
export const sameSource = (a: PluginSource, b: PluginSource): boolean => {
  if (a.kind === "github" && b.kind === "github") {
    return (
      a.owner.toLowerCase() === b.owner.toLowerCase() &&
      a.repo.toLowerCase() === b.repo.toLowerCase()
    );
  }
  return a.kind === "local" && b.kind === "local" && a.path === b.path;
};

export const pluginScriptName = (id: string): string => `t3mode-plugin/${id}.js`;

/**
 * Wraps a CommonJS bundle so that running it only registers the plugin; `load()` runs its code.
 * The newline before the closing brace keeps a trailing `//` comment in the bundle from
 * swallowing it.
 */
export const wrapPluginCode = (id: string, code: string): string => {
  if (!isPluginId(id)) throw new Error(`Invalid plugin id: ${JSON.stringify(id)}`);
  return [
    "(window.__t3modePlugins ??= []).push({",
    `  id: ${JSON.stringify(id)},`,
    "  load: () => {",
    "    const module = { exports: {} };",
    "    (function (module, exports) {",
    code,
    "    })(module, module.exports);",
    "    return module.exports;",
    "  },",
    "});",
  ].join("\n");
};
