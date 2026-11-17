// IPC handlers for the preload. Every call must come from the top frame of T3 Code's main window.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { app, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from "electron";

import { Channel, type Info, isMainWindowUrl } from "@t3mode/shared/Ipc";
import { T3MODE_VERSION } from "@t3mode/shared/Version";

import { Backends } from "./Backends.ts";
import { BootGuard } from "./BootGuard.ts";
import { Disks } from "./Disks.ts";
import { withElectronFetch } from "./ElectronFetch.ts";
import { Home } from "./Home.ts";
import { PluginDataStore } from "./PluginDataStore.ts";
import { PluginHost } from "./PluginHost.ts";
import { SettingsStore } from "./SettingsStore.ts";
import { ShortcutActionSchema, T3Keybindings } from "./T3Keybindings.ts";
import { Reconcile } from "./Reconcile.ts";
import { Updater } from "./Updater.ts";

const UpdateActionSchema = Schema.Literals(["status", "check", "restart"]);

export class IpcRefusedError extends Schema.TaggedError<IpcRefusedError>()("IpcRefusedError", {
  channel: Schema.String,
  url: Schema.String,
}) {
  override get message(): string {
    return `t3mode refused ${this.channel} from ${this.url || "an unknown frame"}.`;
  }
}

export class OpenPathError extends Schema.TaggedError<OpenPathError>()("OpenPathError", {
  path: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `Could not open ${this.path}: ${this.reason}`;
  }
}

const openPath = Effect.fn("Ipc.openPath")(function* (path: string) {
  // Electron resolves with an error message, or "" on success.
  const reason = yield* Effect.tryPromise({
    try: () => shell.openPath(path),
    catch: (cause) => new OpenPathError({ path, reason: String(cause) }),
  });
  if (reason !== "") return yield* new OpenPathError({ path, reason });
});

const LogArgs = Schema.Tuple([Schema.Literals(["debug", "info", "warn", "error"]), Schema.String]);

const logAt = (level: (typeof LogArgs.Type)[0], message: string) => {
  switch (level) {
    case "debug":
      return Effect.logDebug(message);
    case "info":
      return Effect.logInfo(message);
    case "warn":
      return Effect.logWarning(message);
    case "error":
      return Effect.logError(message);
  }
};

/** Install, update and remove change which backends and tool servers run. */
const changesPlugins = (action: unknown) =>
  typeof action === "object" &&
  action !== null &&
  ["install", "update", "remove"].includes(String((action as { _tag?: unknown })._tag));

const checkSender = (channel: string, event: IpcMainInvokeEvent) => {
  const frame = event.senderFrame;
  const url = frame?.url ?? "";
  return frame && frame.parent === null && isMainWindowUrl(url)
    ? Effect.void
    : Effect.fail(new IpcRefusedError({ channel, url }));
};

export const register = Effect.fn("Ipc.register")(function* (options: {
  readonly safeMode: boolean;
}) {
  const plugins = yield* PluginHost;
  const guard = yield* BootGuard;
  const settings = yield* SettingsStore;
  const pluginData = yield* PluginDataStore;
  const keybindings = yield* T3Keybindings;
  const updater = yield* Updater;
  const disks = yield* Disks;
  const reconcile = yield* Reconcile;
  const backends = yield* Backends;
  // Pages that asked for the update status get every change pushed to them.
  const subscribed = new WeakSet<WebContents>();
  const subscribe = (sender: WebContents) =>
    subscribed.has(sender)
      ? Effect.void
      : Effect.andThen(
          Effect.sync(() => subscribed.add(sender)),
          updater.subscribe((status) => {
            if (!sender.isDestroyed()) sender.send(Channel.updateChanged, status);
          }),
        );
  const { layout } = yield* Home;
  const run = Effect.runPromiseWith(yield* Effect.context<never>());

  const handle = <A, E>(
    channel: string,
    handler: (args: ReadonlyArray<unknown>, event: IpcMainInvokeEvent) => Effect.Effect<A, E>,
  ) =>
    ipcMain.handle(channel, (event, ...args) =>
      run(
        checkSender(channel, event).pipe(
          Effect.andThen(handler(args, event)),
          Effect.tapError((error) => Effect.logWarning(`IPC ${channel} failed`, error)),
          Effect.annotateLogs({ channel }),
        ),
      ),
    );

  yield* Effect.sync(() => {
    handle(Channel.pageScripts, () => plugins.pageScripts);
    handle(Channel.pluginScript, (args) => plugins.pluginScript(args[0]));
    handle(Channel.plugins, (args) =>
      withElectronFetch(plugins.act(args[0])).pipe(
        Effect.tap(() => (changesPlugins(args[0]) ? reconcile.refresh : Effect.void)),
      ),
    );
    handle(Channel.log, (args) =>
      Schema.decodeUnknownEffect(LogArgs)(args).pipe(
        Effect.flatMap(([level, message]) =>
          logAt(level, message).pipe(Effect.annotateLogs({ source: "renderer" })),
        ),
      ),
    );
    // A reload (Ctrl+R) also picks up a linked plugin's rebuilt backend.
    handle(Channel.ready, () =>
      guard.markHealthy.pipe(
        Effect.andThen(Effect.logInfo("Renderer ready")),
        Effect.andThen(reconcile.refresh),
      ),
    );
    handle(Channel.backend, (args, event) => backends.act(args[0], event.sender));
    handle(Channel.readPluginData, () => pluginData.read);
    handle(Channel.writePluginData, (args) => pluginData.write(args[0], args[1]));
    handle(Channel.readSettings, () => settings.read);
    handle(Channel.writeSettings, (args) =>
      settings.write(args[0]).pipe(Effect.tap(() => reconcile.refresh)),
    );
    handle(Channel.openLogs, () => openPath(layout.logs));
    handle(Channel.disks, () => disks.list);
    handle(Channel.shortcut, (args) =>
      Schema.decodeUnknownEffect(ShortcutActionSchema)(args[0]).pipe(
        Effect.flatMap(keybindings.shortcut),
      ),
    );
    handle(Channel.update, (args, event) =>
      Schema.decodeUnknownEffect(UpdateActionSchema)(args[0]).pipe(
        Effect.tap(() => subscribe(event.sender)),
        Effect.flatMap((action) =>
          action === "check"
            ? updater.check
            : action === "restart"
              ? updater.restart
              : updater.status,
        ),
      ),
    );
    handle(Channel.info, () =>
      Effect.succeed<Info>({
        t3modeVersion: T3MODE_VERSION,
        t3codeVersion: app.getVersion(),
        home: layout.root,
        logs: layout.logs,
        safeMode: options.safeMode,
      }),
    );
  });
});
