// IPC handlers for the preload. Every call must come from the top frame of T3 Code's main window.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { app, ipcMain, type IpcMainInvokeEvent } from "electron";

import { Channel, type Info, isMainWindowUrl } from "@t3mode/shared/Ipc";
import { T3MODE_VERSION } from "@t3mode/shared/Version";

import { BootGuard } from "./BootGuard.ts";
import { Files } from "./Files.ts";
import { Home } from "./Home.ts";

export class IpcRefusedError extends Schema.TaggedError<IpcRefusedError>()("IpcRefusedError", {
  channel: Schema.String,
  url: Schema.String,
}) {
  override get message(): string {
    return `t3mode refused ${this.channel} from ${this.url || "an unknown frame"}.`;
  }
}

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
  const files = yield* Files;
  const guard = yield* BootGuard;
  const { layout } = yield* Home;
  const run = Effect.runPromiseWith(yield* Effect.context<never>());

  const handle = <A, E>(
    channel: string,
    handler: (args: ReadonlyArray<unknown>) => Effect.Effect<A, E>,
  ) =>
    ipcMain.handle(channel, (event, ...args) =>
      run(
        checkSender(channel, event).pipe(
          Effect.andThen(handler(args)),
          Effect.tapError((error) => Effect.logWarning(`IPC ${channel} failed`, error)),
          Effect.annotateLogs({ channel }),
        ),
      ),
    );

  yield* Effect.sync(() => {
    handle(Channel.rendererSource, () =>
      files.readText(layout.rendererJs).pipe(Effect.map(Option.getOrElse(() => ""))),
    );
    handle(Channel.log, (args) =>
      Schema.decodeUnknownEffect(LogArgs)(args).pipe(
        Effect.flatMap(([level, message]) =>
          logAt(level, message).pipe(Effect.annotateLogs({ source: "renderer" })),
        ),
      ),
    );
    handle(Channel.ready, () =>
      guard.markHealthy.pipe(Effect.andThen(Effect.logInfo("Renderer ready"))),
    );
    handle(Channel.info, () =>
      Effect.succeed<Info>({
        t3modeVersion: T3MODE_VERSION,
        t3codeVersion: app.getVersion(),
        home: layout.root,
        safeMode: options.safeMode,
      }),
    );
  });
});
