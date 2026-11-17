// Desktop indicators: a small window above every app, one per plugin backend that asked for one,
// drawn from t3mode's own template (see "Desktop indicator" in docs/architecture.md). Main owns the
// window and answers the backend host's probes with its rectangle; the host owns presence. Stop
// goes from the window's own preload to main to the backend that owns it, never through T3 Code's
// page.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeUrl from "node:url";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  session,
  type IpcMainEvent,
  type WebContents,
} from "electron";

import { type IndicatorReply, type ToIndicator, clipIndicatorText } from "@t3mode/shared/Backends";
import { Channel, isMainWindowUrl } from "@t3mode/shared/Ipc";
import type { HomeLayout } from "@t3mode/shared/Layout";

import type { BackendOwner, IndicatorHooks } from "./BackendSupervisor.ts";

const WIDTH = 480;
const HEIGHT = 44;
const INSET = 12;
const PARTITION = "t3mode-indicator";

const RequestSchema = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("show"),
    id: Schema.Int,
    label: Schema.String,
    detail: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    op: Schema.Literal("detail"),
    id: Schema.Int,
    detail: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ op: Schema.Literal("probe"), id: Schema.Int, n: Schema.Int }),
  Schema.Struct({ op: Schema.Literal("close"), id: Schema.Int }),
]);

const FromIndicatorSchema = Schema.Union([
  Schema.Struct({ op: Schema.Literal("painted"), epoch: Schema.String, n: Schema.Int }),
  Schema.Struct({ op: Schema.Literal("stop"), epoch: Schema.String }),
]);

/** An indicator window's page. No plugin or T3 Code code runs there. */
export const isIndicator = (contents: WebContents): boolean =>
  contents.session === session.fromPartition(PARTITION);

const decodeRequest = Schema.decodeUnknownOption(RequestSchema);
const decodeFromIndicator = Schema.decodeUnknownOption(FromIndicatorSchema);

/** One shown window. */
interface Entry {
  readonly owner: BackendOwner;
  readonly id: number;
  /** Names this window to its renderer, so nothing meant for an earlier one counts. */
  readonly epoch: string;
  readonly window: BrowserWindow;
  readonly label: string;
  detail: string | null;
  /** The renderer has its model and its Stop handler. */
  loaded: boolean;
  /** The probe waiting for the renderer's answer. */
  probe: number | undefined;
  /** The user pressed Stop. It stops answering probes, so presence ends. */
  stopped: boolean;
}

export const make = Effect.fnUntraced(function* (layout: HomeLayout) {
  const run = Effect.runForkWith(yield* Effect.context<never>());
  const entries = new Map<BackendOwner, Entry>();
  /** T3 Code's own windows on its app URL. An indicator never outlives the last one. */
  const mainWindows = new Set<BrowserWindow>();
  const allowed = new Set(
    [layout.indicatorHtml, layout.indicatorJs].map((file) => NodeUrl.pathToFileURL(file).href),
  );
  let hardened = false;

  const warn = (message: string) => run(Effect.logWarning(message));

  const send = (entry: Entry, message: ToIndicator) => {
    if (!entry.window.isDestroyed()) entry.window.webContents.send(Channel.toIndicator, message);
  };

  const destroy = (entry: Entry) => {
    entries.delete(entry.owner);
    if (!entry.window.isDestroyed()) entry.window.destroy();
  };

  /** Ends a window the backend didn't close, and tells its backend. */
  const lose = (entry: Entry, why: string) => {
    if (entries.get(entry.owner) !== entry) return;
    destroy(entry);
    warn(`Desktop indicator of ${entry.owner.plugin} ended: ${why}`);
    entry.owner.reply({ op: "ended", id: entry.id, reason: "unavailable" });
  };

  const loseAll = (why: string) => {
    for (const entry of entries.values()) lose(entry, why);
  };

  const showing = (entry: Entry) =>
    !entry.window.isDestroyed() && entry.window.isVisible() && !entry.window.isMinimized();

  const forward = (entry: Entry) => {
    if (!entry.loaded || entry.stopped || entry.probe === undefined || !showing(entry)) return;
    entry.window.moveTop();
    send(entry, { op: "probe", epoch: entry.epoch, n: entry.probe });
  };

  const render = (entry: Entry) =>
    send(entry, { op: "render", epoch: entry.epoch, label: entry.label, detail: entry.detail });

  const harden = () => {
    if (hardened) return;
    hardened = true;
    const own = session.fromPartition(PARTITION);
    own.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    own.setPermissionCheckHandler(() => false);
    own.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: !allowed.has(details.url) }),
    );
  };

  const show = (owner: BackendOwner, id: number, label: string, detail: string | null) => {
    const old = entries.get(owner);
    if (old) destroy(old);
    if (!app.isReady() || mainWindows.size === 0) {
      owner.reply({ op: "ended", id, reason: "unavailable" });
      return;
    }
    harden();
    const { workArea } = screen.getPrimaryDisplay();
    const window = new BrowserWindow({
      x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
      y: workArea.y + INSET,
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: "#18181b",
      hasShadow: false,
      // Without it, Windows adds an invisible resize border around the window's rectangle.
      thickFrame: false,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      webPreferences: {
        preload: layout.indicatorPreload,
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        devTools: false,
        spellcheck: false,
        backgroundThrottling: false,
        navigateOnDragDrop: false,
      },
    });
    const entry: Entry = {
      owner,
      id,
      epoch: NodeCrypto.randomUUID(),
      window,
      label: clipIndicatorText(label),
      detail: detail === null ? null : clipIndicatorText(detail),
      loaded: false,
      probe: undefined,
      stopped: false,
    };
    entries.set(owner, entry);
    window.setAlwaysOnTop(true, "pop-up-menu");
    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.once("did-finish-load", () => {
      if (entries.get(owner) !== entry) return;
      entry.loaded = true;
      render(entry);
      window.showInactive();
      forward(entry);
    });
    contents.on("did-fail-load", (_event, code, description) =>
      lose(entry, `load failed (${code} ${description})`),
    );
    contents.on("render-process-gone", (_event, details) =>
      lose(entry, `renderer gone (${details.reason})`),
    );
    contents.on("unresponsive", () => lose(entry, "renderer unresponsive"));
    window.on("hide", () => lose(entry, "hidden"));
    window.on("minimize", () => lose(entry, "minimized"));
    window.on("closed", () => lose(entry, "closed"));
    void window.loadFile(layout.indicatorHtml).catch(() => undefined);
  };

  const request = (owner: BackendOwner, input: unknown) => {
    const decoded = decodeRequest(input);
    if (Option.isNone(decoded)) {
      warn(`Ignored a malformed desktop indicator request from ${owner.plugin}`);
      return;
    }
    const message = decoded.value;
    if (message.op === "show") {
      show(owner, message.id, message.label, message.detail);
      return;
    }
    const entry = entries.get(owner);
    if (!entry || entry.id !== message.id) return;
    switch (message.op) {
      case "detail":
        entry.detail = message.detail === null ? null : clipIndicatorText(message.detail);
        render(entry);
        return;
      case "probe":
        entry.probe = message.n;
        forward(entry);
        return;
      case "close":
        destroy(entry);
        return;
    }
  };

  const fromWindow = (event: IpcMainEvent, input: unknown) => {
    const entry = [...entries.values()].find(
      (candidate) =>
        !candidate.window.isDestroyed() && candidate.window.webContents === event.sender,
    );
    const decoded = decodeFromIndicator(input);
    if (
      !entry ||
      event.senderFrame !== event.sender.mainFrame ||
      Option.isNone(decoded) ||
      decoded.value.epoch !== entry.epoch ||
      entry.stopped
    ) {
      return;
    }
    const message = decoded.value;
    if (message.op === "stop") {
      entry.stopped = true;
      entry.probe = undefined;
      entry.owner.reply({ op: "ended", id: entry.id, reason: "stop" });
      return;
    }
    if (message.n !== entry.probe || !showing(entry)) return;
    entry.probe = undefined;
    const bounds = screen.dipToScreenRect(entry.window, entry.window.getBounds());
    const reply: IndicatorReply = { op: "painted", id: entry.id, n: message.n, rect: bounds };
    entry.owner.reply(reply);
  };

  yield* Effect.sync(() => {
    ipcMain.on(Channel.fromIndicator, fromWindow);
    app.on("browser-window-created", (_event, window) => {
      const contents = window.webContents;
      contents.on("did-navigate", (_navigation, url) => {
        if (isMainWindowUrl(url)) mainWindows.add(window);
      });
      // `closed`, not the cancellable `close`. With no indicator left, T3 Code's
      // window-all-closed sees no windows and quits as it would without t3mode.
      window.once("closed", () => {
        if (mainWindows.delete(window) && mainWindows.size === 0) {
          loseAll("T3 Code's last window closed");
        }
      });
    });
    app.on("before-quit", () => loseAll("T3 Code is quitting"));
    void app.whenReady().then(() => {
      screen.on("display-removed", () => loseAll("a display was removed"));
      screen.on("display-metrics-changed", () => loseAll("display settings changed"));
    });
  });

  return {
    request,
    dispose: (owner) => {
      const entry = entries.get(owner);
      if (entry) destroy(entry);
    },
  } satisfies IndicatorHooks;
});
