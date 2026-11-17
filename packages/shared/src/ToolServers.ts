// Plugin tool servers: the MCP stdio servers t3mode registers in Claude's and Codex's user config
// (see "Tool servers" in docs/architecture.md). Each entry runs T3 Code's own exe in Node mode on
// the plugin's `mcp` script, and carries T3MODE_HOME in its env. That variable marks the entry as
// this home's: t3mode rewrites and removes only those, so a sandbox and the real install, which
// share these files, never touch each other's entries or the user's own.
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/** Registered names are `t3mode-<plugin id>`. */
export const TOOL_SERVER_PREFIX = "t3mode-";
export const HOME_MARKER_ENV = "T3MODE_HOME";

export interface ToolServer {
  readonly id: string;
  /** Absolute path of the plugin's `mcp` script, under `<home>/plugins/<id>/`. */
  readonly script: string;
}

export interface ToolServerTarget {
  /** T3 Code's exe, run with ELECTRON_RUN_AS_NODE=1. */
  readonly exe: string;
  /** The t3mode home root, written into each entry as T3MODE_HOME. */
  readonly home: string;
}

export interface ConfigEdit {
  /** The new file text, or undefined when nothing changed. */
  readonly text: string | undefined;
  /** Plugin ids whose entry this home owned and no longer has. */
  readonly removed: ReadonlyArray<string>;
  /** Plugin ids whose name is taken by an entry this home doesn't own. */
  readonly conflicts: ReadonlyArray<string>;
  /** Why the file was left alone, when t3mode can't edit it safely. */
  readonly refused?: string;
}

const refuse = (refused: string): ConfigEdit => ({
  text: undefined,
  removed: [],
  conflicts: [],
  refused,
});

export const toolServerName = (id: string) => `${TOOL_SERVER_PREFIX}${id}`;

const idOf = (name: string) =>
  name.startsWith(TOOL_SERVER_PREFIX) ? name.slice(TOOL_SERVER_PREFIX.length) : undefined;

/** Windows paths compare without case, and with either slash. */
const normalizePath = (value: string) =>
  value.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
const samePath = (a: string, b: string) => normalizePath(a) === normalizePath(b);

const serverEnv = (target: ToolServerTarget) => ({
  ELECTRON_RUN_AS_NODE: "1",
  [HOME_MARKER_ENV]: target.home,
});

// --- Claude: ~/.claude.json, `mcpServers` -----------------------------------------------------

const claudeEntry = (target: ToolServerTarget, server: ToolServer) => ({
  type: "stdio",
  command: target.exe,
  args: [server.script],
  env: serverEnv(target),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ownsClaudeEntry = (entry: unknown, home: string) => {
  if (!isRecord(entry) || !isRecord(entry["env"])) return false;
  const marker = entry["env"][HOME_MARKER_ENV];
  return typeof marker === "string" && samePath(marker, home);
};

/**
 * Edits the text of `~/.claude.json`. Refuses text that isn't a JSON object: the file is Claude's,
 * and t3mode never rewrites what it can't read.
 */
export const editClaudeConfig = (
  text: string,
  target: ToolServerTarget,
  servers: ReadonlyArray<ToolServer>,
): ConfigEdit => {
  const notJson = refuse("it isn't a JSON object with an mcpServers object");
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch {
    return notJson;
  }
  if (!isRecord(config)) return notJson;
  const existing = config["mcpServers"];
  if (existing !== undefined && !isRecord(existing)) return notJson;
  const current: Record<string, unknown> = existing ?? {};
  const next: Record<string, unknown> = {};
  const removed: Array<string> = [];
  const conflicts: Array<string> = [];
  const wanted = new Map(servers.map((server) => [toolServerName(server.id), server]));
  for (const [name, entry] of Object.entries(current)) {
    const id = idOf(name);
    if (id === undefined || !ownsClaudeEntry(entry, target.home)) {
      next[name] = entry;
      continue;
    }
    const server = wanted.get(name);
    if (server) next[name] = claudeEntry(target, server);
    else removed.push(id);
  }
  for (const [name, server] of wanted) {
    if (Object.hasOwn(next, name)) {
      if (!ownsClaudeEntry(next[name], target.home)) conflicts.push(server.id);
      continue;
    }
    next[name] = claudeEntry(target, server);
  }
  if (JSON.stringify(next) === JSON.stringify(current) && existing !== undefined) {
    return { text: undefined, removed, conflicts };
  }
  if (existing === undefined && Object.keys(next).length === 0) {
    return { text: undefined, removed, conflicts };
  }
  const indent = /^\{\r?\n(\s+)"/.exec(text)?.[1] ?? "  ";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const body = JSON.stringify({ ...config, mcpServers: next }, null, indent).replaceAll("\n", eol);
  return { text: /\r?\n$/.test(text) ? `${body}${eol}` : body, removed, conflicts };
};

// --- Codex: ~/.codex/config.toml, `[mcp_servers.<name>]` ---------------------------------------
// Edited as text, never through `codex mcp`, which rewrites the whole file. Only whole tables named
// `mcp_servers.t3mode-<id>` (and their subtables) that carry this home's marker are touched.

const KEY_PART = String.raw`(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')`;
const DOTTED_KEY = new RegExp(String.raw`^\s*(${KEY_PART}(?:\s*\.\s*${KEY_PART})*)\s*`);
const HEADER = new RegExp(
  String.raw`^\s*\[\[?\s*(${KEY_PART}(?:\s*\.\s*${KEY_PART})*)\s*\]\]?\s*(?:#.*)?$`,
);
const ASSIGNMENT = new RegExp(`${DOTTED_KEY.source}=`);
const MARKER_VALUE = new RegExp(
  String.raw`(?:^|[\s{,])${HOME_MARKER_ENV}\s*=\s*("(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*')`,
  "m",
);

const keyParts = (dotted: string): ReadonlyArray<string> =>
  (dotted.match(new RegExp(KEY_PART, "g")) ?? []).map((part) => {
    if (part.startsWith("'")) return part.slice(1, -1);
    if (!part.startsWith('"')) return part;
    try {
      return JSON.parse(part) as string;
    } catch {
      return part;
    }
  });

const tomlString = (value: string) => {
  const decoded = value.startsWith("'") ? value.slice(1, -1) : undefined;
  if (decoded !== undefined) return decoded;
  try {
    return JSON.parse(value) as string;
  } catch {
    return undefined;
  }
};

// JSON string escapes are valid TOML basic-string escapes.
const basic = (value: string) => JSON.stringify(value);

export const codexTable = (target: ToolServerTarget, server: ToolServer): ReadonlyArray<string> => [
  `[mcp_servers.${toolServerName(server.id)}]`,
  `command = ${basic(target.exe)}`,
  `args = [${basic(server.script)}]`,
  `env = { ELECTRON_RUN_AS_NODE = "1", ${HOME_MARKER_ENV} = ${basic(target.home)} }`,
];

interface Block {
  /** First line of the table, its header. Undefined for the lines before any header. */
  readonly start: number;
  /** One past the table's last line that is neither blank nor a comment. */
  readonly end: number;
  readonly path: ReadonlyArray<string> | undefined;
}

const isComment = (line: string) => line.trimStart().startsWith("#");

const blocksOf = (lines: ReadonlyArray<string>): ReadonlyArray<Block> => {
  const blocks: Array<Block> = [];
  let start = 0;
  let path: ReadonlyArray<string> | undefined;
  const close = (stop: number) => {
    let end = stop;
    while (end > start && (lines[end - 1]!.trim() === "" || isComment(lines[end - 1]!))) end--;
    blocks.push({ start, end, path });
  };
  lines.forEach((line, index) => {
    const header = HEADER.exec(line);
    if (!header) return;
    close(index);
    start = index;
    path = keyParts(header[1]!);
  });
  close(lines.length);
  return blocks;
};

/** Edits the text of Codex's `config.toml`, keeping its line endings and final newline. */
export const editCodexConfig = (
  text: string,
  target: ToolServerTarget,
  servers: ReadonlyArray<ToolServer>,
): ConfigEdit => {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const finalNewline = text === "" || /\r?\n$/.test(text);
  const lines = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
  const blocks = blocksOf(lines);

  // Every name under mcp_servers, from table headers and from dotted keys, owned or not.
  const tables = new Map<string, Array<Block>>();
  const taken = new Set<string>();
  let inline = false;
  for (const block of blocks) {
    const path = block.path ?? [];
    if (path[0] === "mcp_servers" && path.length >= 2) {
      const name = path[1]!;
      taken.add(name);
      tables.set(name, [...(tables.get(name) ?? []), block]);
      continue;
    }
    for (let index = block.start; index < block.end; index++) {
      const key = ASSIGNMENT.exec(lines[index]!);
      if (!key) continue;
      const parts = [...path, ...keyParts(key[1]!)];
      if (parts[0] === "mcp_servers" && parts.length >= 2) taken.add(parts[1]!);
      // `mcp_servers = { ... }` defines the whole table, and no header may extend it.
      if (parts.length === 1 && parts[0] === "mcp_servers") inline = true;
    }
  }
  if (inline) return refuse("it sets mcp_servers as an inline table");

  const wanted = new Map(servers.map((server) => [toolServerName(server.id), server]));
  const drop = new Set<Block>();
  const keep = new Set<string>();
  const removed: Array<string> = [];
  for (const [name, own] of tables) {
    const id = idOf(name);
    if (id === undefined) continue;
    const body = own.map((block) => lines.slice(block.start, block.end).join("\n")).join("\n");
    const marker = MARKER_VALUE.exec(body)?.[1];
    const home = marker === undefined ? undefined : tomlString(marker);
    if (home === undefined || !samePath(home, target.home)) continue;
    const server = wanted.get(name);
    if (server && body === codexTable(target, server).join("\n")) {
      keep.add(name);
      continue;
    }
    for (const block of own) drop.add(block);
    if (!server) removed.push(id);
  }

  const conflicts: Array<string> = [];
  const added: Array<ReadonlyArray<string>> = [];
  for (const [name, server] of wanted) {
    if (keep.has(name)) continue;
    const owned = (tables.get(name) ?? []).some((block) => drop.has(block));
    if (taken.has(name) && !owned) {
      conflicts.push(server.id);
      continue;
    }
    added.push(codexTable(target, server));
  }
  if (drop.size === 0 && added.length === 0) return { text: undefined, removed, conflicts };

  // A dropped table goes with the blank lines after it, but comments after it stay: they belong to
  // what follows. At the end of the file it also takes the blank line before it, which t3mode
  // added, so adding then removing gives the file back.
  const out: Array<string> = [];
  blocks.forEach((block, index) => {
    const next = blocks[index + 1];
    const stop = next ? next.start : lines.length;
    if (!drop.has(block)) {
      out.push(...lines.slice(block.start, stop));
      return;
    }
    const after = lines.slice(block.end, stop);
    if (after.some(isComment)) out.push(...after);
  });
  while (out.length > 0 && out.at(-1)!.trim() === "" && drop.has(blocks.at(-1)!)) out.pop();
  for (const table of added) {
    while (out.length > 0 && out.at(-1)!.trim() === "") out.pop();
    if (out.length > 0) out.push("");
    out.push(...table);
  }
  const body = out.join(eol);
  return { text: finalNewline && body !== "" ? `${body}${eol}` : body, removed, conflicts };
};

// --- Stopping a plugin's processes -------------------------------------------------------------

const quotePowerShell = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * A Windows PowerShell script that stops every process running `exe` whose command line names a
 * file under one of `folders`, waits for them to exit, and prints how many it stopped. Windows
 * keeps a loaded `.node` file locked until its process exits, so files can be replaced after this.
 * Matching on the exe too spares Explorer or an editor opened on the folder.
 */
export const stopProcessesScript = (exe: string, folders: ReadonlyArray<string>): string => {
  const prefixes = folders.map((folder) => quotePowerShell(`${folder.replace(/[\\/]+$/, "")}\\`));
  return [
    "$ErrorActionPreference = 'Stop'",
    `$exe = ${quotePowerShell(exe)}`,
    `$folders = @(${prefixes.join(", ")})`,
    "$found = @(Get-CimInstance Win32_Process | Where-Object {",
    "  $p = $_",
    "  $p.ProcessId -ne $PID -and $p.ExecutablePath -and $p.CommandLine -and",
    "  [string]::Equals($p.ExecutablePath, $exe, [StringComparison]::OrdinalIgnoreCase) -and",
    "  @($folders | Where-Object { $p.CommandLine.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -gt 0",
    "})",
    "foreach ($p in $found) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }",
    "foreach ($p in $found) { Wait-Process -Id $p.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }",
    "$found.Count",
  ].join("\n");
};

// --- Writing the provider configs ---------------------------------------------------------------

export interface ConfigPaths {
  readonly claude: string;
  readonly codex: string;
}

/** Where Claude and Codex read their user config, honoring CLAUDE_CONFIG_DIR and CODEX_HOME. */
export const configPaths = (
  env: Readonly<Record<string, string | undefined>>,
  userHome: string,
  join: (...parts: ReadonlyArray<string>) => string,
): ConfigPaths => ({
  claude: join(env["CLAUDE_CONFIG_DIR"]?.trim() || userHome, ".claude.json"),
  codex: join(env["CODEX_HOME"]?.trim() || join(userHome, ".codex"), "config.toml"),
});

/**
 * `<home>/plugins/package.json`. Node picks a `.js` file's module type from the nearest
 * package.json above it, and a user's `~/package.json` with `"type": "module"` would make every
 * plugin script ESM. This file stops that search inside the plugins folder.
 */
export const COMMONJS_MARKER = `{ "type": "commonjs" }\n`;

/** How many times a config edit starts over when the file changed under it. */
const EDIT_ATTEMPTS = 3;

export interface SyncResult {
  /** Plugin ids that lost their registration in at least one config. */
  readonly removed: ReadonlyArray<string>;
  readonly conflicts: ReadonlyArray<{ readonly config: string; readonly id: string }>;
  readonly failures: ReadonlyArray<{ readonly config: string; readonly message: string }>;
}

/**
 * Makes both configs register exactly `servers` for this home. A config is skipped when its
 * provider isn't set up (no `.claude.json`, no Codex folder) or when it can't be read. Never fails.
 */
export const sync = Effect.fn("ToolServers.sync")(function* (options: {
  readonly target: ToolServerTarget;
  readonly paths: ConfigPaths;
  readonly pluginsFolder: string;
  readonly servers: ReadonlyArray<ToolServer>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const removed = new Set<string>();
  const conflicts: Array<{ config: string; id: string }> = [];
  const failures: Array<{ config: string; message: string }> = [];

  if (options.servers.length > 0) {
    const marker = path.join(options.pluginsFolder, "package.json");
    yield* fs.readFileString(marker).pipe(
      Effect.orElseSucceed(() => ""),
      Effect.flatMap((text) =>
        text === COMMONJS_MARKER ? Effect.void : fs.writeFileString(marker, COMMONJS_MARKER),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          failures.push({ config: marker, message: `Could not write ${marker}: ${error.message}` });
        }),
      ),
    );
  }

  // Claude and Codex rewrite their config while they run. The file is read again just before
  // the rename, and the edit starts over from the new text when it changed in between.
  const apply = (
    config: string,
    present: Effect.Effect<boolean>,
    edit: (text: string) => ConfigEdit,
  ) =>
    Effect.gen(function* () {
      if (!(yield* present)) return;
      const read = fs
        .exists(config)
        .pipe(
          Effect.flatMap((exists) => (exists ? fs.readFileString(config) : Effect.succeed(""))),
        );
      const temp = `${config}.t3mode-${process.pid}.tmp`;
      for (let attempt = 0; attempt < EDIT_ATTEMPTS; attempt++) {
        const text = yield* read;
        const result = edit(text);
        if (result.refused !== undefined) {
          failures.push({ config, message: `t3mode left ${config} alone: ${result.refused}.` });
          return;
        }
        if (result.text !== undefined) {
          yield* fs.writeFileString(temp, result.text);
          if ((yield* read) !== text) {
            yield* fs.remove(temp, { force: true });
            continue;
          }
          yield* fs
            .rename(temp, config)
            .pipe(Effect.tapError(() => fs.remove(temp, { force: true }).pipe(Effect.ignore)));
        }
        for (const id of result.removed) removed.add(id);
        for (const id of result.conflicts) conflicts.push({ config, id });
        return;
      }
      yield* fs.remove(temp, { force: true }).pipe(Effect.ignore);
      failures.push({
        config,
        message: `${config} kept changing while t3mode edited it; it will try again later.`,
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          failures.push({ config, message: `Could not update ${config}: ${error.message}` });
        }),
      ),
    );

  const exists = (file: string) => fs.exists(file).pipe(Effect.orElseSucceed(() => false));
  yield* apply(options.paths.claude, exists(options.paths.claude), (text) =>
    editClaudeConfig(text, options.target, options.servers),
  );
  yield* apply(options.paths.codex, exists(path.dirname(options.paths.codex)), (text) =>
    editCodexConfig(text, options.target, options.servers),
  );
  return { removed: [...removed], conflicts, failures } satisfies SyncResult;
});
