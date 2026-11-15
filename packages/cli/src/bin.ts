// `pnpm t3mode <command>`: install, repair, uninstall, deploy, status, safe, sandbox, plugin.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { Argument, Command, Flag, Prompt } from "effect/cli";
import { FetchHttpClient } from "effect/http";

import {
  GITHUB_URL_ENV,
  HOME_ENV,
  SANDBOX_APPDATA_ENV,
  SANDBOX_INSTALLER_ENV,
  githubUrl,
} from "@t3mode/shared/Layout";
import { type InstalledPlugin, sourceLabel } from "@t3mode/shared/Plugins";
import * as PluginStore from "@t3mode/shared/PluginStore";
import { T3MODE_VERSION } from "@t3mode/shared/Version";

import * as Artifacts from "./Artifacts.ts";
import * as AsarArchive from "./Asar.ts";
import * as Install from "./Install.ts";
import * as Processes from "./Processes.ts";
import * as Target from "./Target.ts";

const root = Command.make("t3mode").pipe(
  Command.withSharedFlags({
    installDir: Flag.Directory("install-dir").pipe(
      Flag.withDescription("T3 Code install folder (default: %LOCALAPPDATA%\\Programs\\t3code)"),
      Flag.optional,
    ),
    home: Flag.Directory("home").pipe(
      Flag.withDescription(`t3mode data folder (default: $${HOME_ENV} or %APPDATA%\\t3mode)`),
      Flag.optional,
    ),
  }),
  Command.withDescription("Plugins for the T3 Code desktop app"),
);

const target = Effect.gen(function* () {
  return yield* Target.resolve(yield* root);
});

const wait = Flag.Boolean("wait").pipe(
  Flag.withDescription("Wait for T3 Code to close instead of failing"),
  Flag.withDefault(false),
);
const launchAfter = Flag.Boolean("launch").pipe(
  Flag.withDescription("Start T3 Code when done"),
  Flag.withDefault(false),
);

const describeApply: Record<Install.ApplyResult, string> = {
  installed: "Shim installed.",
  "reapplied-after-update": "Shim re-applied after a T3 Code update.",
  refreshed: "Shim refreshed.",
};

const installOrRepair = (withDeploy: boolean) =>
  Effect.fn(function* (options: { readonly wait: boolean; readonly launch: boolean }) {
    const t = yield* target;
    yield* Processes.ensureClosed(t.installDir, options.wait);
    if (withDeploy) {
      yield* Artifacts.deploy(t.home);
      yield* Console.log(`Bundles copied to ${t.home.dist}.`);
    }
    const result = yield* Install.applyShim(t, yield* Artifacts.shimEntry);
    yield* Console.log(describeApply[result]);
    if (options.launch) yield* Processes.launch(t.exe, []);
  });

const install = Command.make("install", { wait, launch: launchAfter }, installOrRepair(true)).pipe(
  Command.withDescription("Copy the bundles and install the shim"),
);

const repair = Command.make("repair", { wait, launch: launchAfter }, installOrRepair(false)).pipe(
  Command.withDescription("Re-apply the shim after a T3 Code update replaced it"),
);

const uninstall = Command.make(
  "uninstall",
  {
    wait,
    purge: Flag.Boolean("purge").pipe(
      Flag.withDescription("Also delete the t3mode data folder"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function* (options) {
    const t = yield* target;
    const fs = yield* FileSystem.FileSystem;
    yield* Processes.ensureClosed(t.installDir, options.wait);
    const result = yield* Install.removeShim(t);
    yield* Console.log(
      result === "removed" ? "Original T3 Code restored." : "t3mode was not installed.",
    );
    if (options.purge) {
      yield* fs.remove(t.home.root, { recursive: true, force: true });
      yield* Console.log(`Deleted ${t.home.root}.`);
    }
  }),
).pipe(Command.withDescription("Restore the original T3 Code"));

const deploy = Command.make(
  "deploy",
  {},
  Effect.fn(function* () {
    const t = yield* target;
    yield* Artifacts.deploy(t.home);
    yield* Console.log(
      `Bundles copied to ${t.home.dist}. Reload the window (Ctrl+R) to pick up renderer changes.`,
    );
  }),
).pipe(Command.withDescription("Copy freshly built bundles into the t3mode home"));

const status = Command.make(
  "status",
  {},
  Effect.fn(function* () {
    const t = yield* target;
    const fs = yield* FileSystem.FileSystem;
    const s = yield* Install.readStatus(t);
    const running = yield* Processes.countRunningIn(t.installDir);
    const deployed = yield* fs.exists(t.home.mainJs);
    const safeMode = yield* fs.exists(t.home.safeMode);
    const state = yield* fs.readFileString(t.home.state).pipe(Effect.option);
    const log = yield* fs.readFileString(t.home.mainLog).pipe(Effect.option);
    const ready = yield* fs.readFileString(t.home.updateReady).pipe(Effect.option);
    const updateLog = yield* fs.readFileString(t.home.updateLog).pipe(Effect.option);
    const pending = Option.flatMap(ready, (text) =>
      Option.fromNullishOr(/"version":"([^"]+)"/.exec(text)?.[1]),
    );
    const archive =
      s.archive === "t3mode"
        ? `t3mode shim v${s.shimVersion}`
        : s.archive === "original"
          ? "original (t3mode not installed, or removed by an update)"
          : `another mod (${s.foreignName})`;
    yield* Console.log(
      [
        `t3mode          ${T3MODE_VERSION}`,
        `T3 Code         ${s.t3codeVersion ?? "unknown"} at ${t.installDir}`,
        `app.asar        ${archive}`,
        `running         ${running > 0 ? `yes (${running} processes)` : "no"}`,
        `home            ${t.home.root}`,
        `bundles         ${deployed ? "deployed" : "missing (run install or deploy)"}`,
        `safe mode       ${safeMode ? "requested for next launch" : "off"}`,
        `boot state      ${Option.getOrElse(state, () => "none").trim()}`,
        `update          ${Option.match(pending, { onNone: () => "none downloaded", onSome: (version) => `${version}, installs when T3 Code quits` })}`,
      ].join("\n"),
    );
    if (Option.isSome(updateLog)) {
      const lines = updateLog.value.trimEnd().split("\n").slice(-5);
      yield* Console.log(`\nLast update lines (${t.home.updateLog}):\n${lines.join("\n")}`);
    }
    if (Option.isSome(log)) {
      const lines = log.value.trimEnd().split("\n").slice(-8);
      yield* Console.log(`\nLast log lines (${t.home.mainLog}):\n${lines.join("\n")}`);
    }
  }),
).pipe(Command.withDescription("Show what is installed and the last log lines"));

const safe = Command.make(
  "safe",
  {},
  Effect.fn(function* () {
    const t = yield* target;
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(t.home.root, { recursive: true });
    yield* fs.writeFileString(t.home.safeMode, "requested from the CLI\n");
    yield* Console.log("The next T3 Code launch runs without t3mode, once.");
  }),
).pipe(Command.withDescription("Run the next launch without t3mode"));

const sandbox = Command.make(
  "sandbox",
  {
    refresh: Flag.Boolean("refresh").pipe(
      Flag.withDescription("Copy T3 Code again before installing"),
      Flag.withDefault(false),
    ),
    port: Flag.Int("port").pipe(
      Flag.withDescription("Chrome DevTools port of the sandbox window"),
      Flag.withDefault(9333),
    ),
    launch: Flag.Boolean("no-launch").pipe(
      Flag.withDescription("Prepare the sandbox without starting it"),
      Flag.withDefault(false),
      Flag.map((noLaunch) => !noLaunch),
    ),
  },
  Effect.fn(function* (options) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const flags = yield* root;
    const source = yield* Target.resolve({ installDir: flags.installDir, home: Option.none() });
    const dir = path.join(yield* Artifacts.repoRoot, ".sandbox");
    const appDir = path.join(dir, "app");

    yield* Processes.ensureClosed(appDir, false);
    if (options.refresh || !(yield* fs.exists(appDir))) {
      yield* Console.log(`Copying ${source.installDir} to ${appDir}…`);
      yield* Processes.mirror(source.installDir, appDir);
    }
    const t = yield* Target.resolve({
      installDir: Option.some(appDir),
      home: Option.some(path.join(dir, "home")),
    });
    yield* Artifacts.deploy(t.home);
    yield* Console.log(describeApply[yield* Install.applyShim(t, yield* Artifacts.shimEntry)]);

    // T3 Code's real installer always updates the real install, so the sandbox gets a stand-in
    // that does to app.asar what an update does: it puts a vanilla archive over the shim.
    const fakeInstaller = path.join(dir, "fake-installer.cmd");
    yield* fs.writeFileString(
      fakeInstaller,
      [
        "@echo off",
        "rem Stand-in for T3 Code's installer in the t3mode sandbox (see pnpm t3mode sandbox).",
        `echo %date% %time% fake installer %* >> "${path.join(dir, "fake-installer.log")}"`,
        `copy /y "${path.join(t.resourcesDir, "_app.asar")}" "${path.join(t.resourcesDir, "app.asar")}" >nul`,
        "",
      ].join("\r\n"),
    );

    if (!options.launch) return;
    // T3 Code's own data goes to the sandbox too, so the copy never touches the real profile or ~/.t3.
    // Keep rendering while another window covers the sandbox, so DevTools sees live updates.
    const args = [
      `--remote-debugging-port=${options.port}`,
      "--disable-features=CalculateNativeWinOcclusion",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ];
    yield* Processes.launch(t.exe, args, {
      [HOME_ENV]: t.home.root,
      [SANDBOX_APPDATA_ENV]: path.join(dir, "appdata"),
      [SANDBOX_INSTALLER_ENV]: fakeInstaller,
      // Also set here, so the sandbox stays isolated even when the loader fails to start.
      APPDATA: path.join(dir, "appdata"),
      T3CODE_HOME: path.join(dir, "t3home"),
      // An update installed from the sandbox would target the real install folder.
      T3CODE_DISABLE_AUTO_UPDATE: "1",
    });
    yield* Console.log(`Sandbox started. DevTools: http://127.0.0.1:${options.port}/json`);
  }),
).pipe(Command.withDescription("Run t3mode on a private copy of T3 Code, for development"));

// Plugins need only the t3mode home, so these commands work without T3 Code, and while it's
// closed. A running T3 Code picks up a change on its next reload (Ctrl+R).
const pluginStore = Effect.gen(function* () {
  const flags = yield* root;
  const layout = yield* Target.resolveHome(flags.home);
  return yield* PluginStore.make({ layout, githubBase: githubUrl(process.env) });
});

const RELOAD = "Reload T3 Code (Ctrl+R) to apply it.";

const describePlugin = (plugin: InstalledPlugin) =>
  [
    `${plugin.id.padEnd(24)} ${plugin.version.padEnd(12)} ${sourceLabel(plugin.source)}`,
    plugin.error === undefined ? null : `  can't load: ${plugin.error}`,
  ]
    .filter((line) => line !== null)
    .join("\n");

const pluginList = Command.make(
  "list",
  {},
  Effect.fn(function* () {
    const plugins = yield* (yield* pluginStore).list;
    yield* Console.log(
      plugins.length === 0
        ? "No plugins installed. Add one with: pnpm t3mode plugin add <owner/repo>"
        : plugins.map(describePlugin).join("\n"),
    );
  }),
).pipe(Command.withDescription("List the installed plugins"));

const pluginAdd = Command.make(
  "add",
  {
    link: Argument.String("link").pipe(
      Argument.withDescription("owner/repo, the repository's link, or a release tag's link"),
    ),
    yes: Flag.Boolean("yes").pipe(
      Flag.withDescription("Install without asking"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function* (options) {
    const store = yield* pluginStore;
    const { source, manifest } = yield* store.preview(options.link);
    yield* Console.log(
      [
        `${manifest.name} ${manifest.version}${manifest.author ? ` by ${manifest.author}` : ""}`,
        `from github.com/${sourceLabel(source)}`,
        manifest.description,
        "",
        "A plugin gets full access to T3 Code, including your threads. Install it only if you trust its author.",
      ].join("\n"),
    );
    if (!options.yes) {
      const confirmed = yield* Prompt.Confirm({ message: `Install ${manifest.name}?` });
      if (!confirmed) {
        yield* Console.log("Nothing was installed.");
        return;
      }
    }
    const installed = yield* store.install(source, manifest.id);
    yield* Console.log(`Installed ${installed.name} ${installed.version}. ${RELOAD}`);
  }),
).pipe(Command.withDescription("Install a plugin from a GitHub release"));

const pluginUpdate = Command.make(
  "update",
  {
    id: Argument.String("id").pipe(
      Argument.withDescription("The plugin to update (default: every plugin with an update)"),
      Argument.optional,
    ),
  },
  Effect.fn(function* (options) {
    const store = yield* pluginStore;
    const ids = Option.isSome(options.id)
      ? [options.id.value]
      : yield* Effect.gen(function* () {
          const { updates, failures } = yield* store.checkUpdates;
          for (const [id, message] of Object.entries(failures)) {
            yield* Console.log(`Could not check ${id}: ${message}`);
          }
          return Object.keys(updates);
        });
    if (ids.length === 0) {
      yield* Console.log("No updates.");
      return;
    }
    for (const id of ids) {
      const updated = yield* store.update(id);
      yield* Console.log(`Installed the latest release of ${updated.name}: ${updated.version}.`);
    }
    yield* Console.log(RELOAD);
  }),
).pipe(Command.withDescription("Install the latest release of unpinned GitHub plugins"));

const pluginRemove = Command.make(
  "remove",
  { id: Argument.String("id").pipe(Argument.withDescription("The plugin's id")) },
  Effect.fn(function* (options) {
    const removed = yield* (yield* pluginStore).remove(options.id);
    yield* Console.log(
      removed ? `Removed ${options.id}. ${RELOAD}` : `${options.id} is not installed.`,
    );
  }),
).pipe(Command.withDescription("Remove a plugin"));

const pluginLink = Command.make(
  "link",
  {
    folder: Argument.Directory("folder", { mustExist: true }).pipe(
      Argument.withDescription("A built plugin: the folder holding manifest.json and plugin.js"),
    ),
  },
  Effect.fn(function* (options) {
    const linked = yield* (yield* pluginStore).link(options.folder);
    yield* Console.log(
      `Linked ${linked.name} ${linked.version}. After each rebuild, reload T3 Code (Ctrl+R) to pick it up.`,
    );
  }),
).pipe(Command.withDescription("Use a plugin you are developing, read from its folder"));

const plugin = Command.make("plugin").pipe(
  Command.withDescription(
    `Install and manage plugins (GitHub downloads go to $${GITHUB_URL_ENV} when it is set)`,
  ),
  Command.withSubcommands([pluginList, pluginAdd, pluginUpdate, pluginRemove, pluginLink]),
);

const MainLayer = Layer.mergeAll(AsarArchive.layer, FetchHttpClient.layer).pipe(
  Layer.provideMerge(NodeServices.layer),
);

root.pipe(
  Command.withSubcommands([install, repair, uninstall, deploy, status, safe, sandbox, plugin]),
  Command.run({ version: T3MODE_VERSION }),
  Effect.provide(MainLayer),
  NodeRuntime.runMain,
);
