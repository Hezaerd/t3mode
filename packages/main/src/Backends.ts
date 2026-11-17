// Plugin backends: one Electron utilityProcess per enabled plugin with a `backend` script (see
// "Backends" in docs/architecture.md). The reconcile tells `apply` which backends should run; this
// module starts, stops and restarts them, carries messages between each one and the page, and
// writes each one's output to its own log. It routes by the plugin id of the process it spawned.
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off - driven by Electron process events, outside any fiber
// @effect-diagnostics globalTimers:off - restart delays outlive the calls that set them
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { app, utilityProcess, type UtilityProcess, type WebContents } from "electron";

import {
  BACKEND_CRASH_WINDOW_MS,
  BACKEND_MAX_CRASHES,
  BackendEnv,
  type BackendEvent,
  type BackendStatus,
  type FromBackendHost,
  type ToBackendHost,
  backendRetryDelay,
} from "@t3mode/shared/Backends";
import { Channel } from "@t3mode/shared/Ipc";
import { PluginIdSchema } from "@t3mode/shared/PluginStore";

import { Home } from "./Home.ts";

/** What one reconcile wants running for a plugin. */
export interface WantedBackend {
  readonly id: string;
  /** The plugin's folder: the process's working directory. */
  readonly folder: string;
  /** The backend script's absolute path. */
  readonly script: string;
  /** Changes when the plugin's files change, so the backend restarts on an update or rebuild. */
  readonly version: string;
}

/** A backend process main started, and what it runs. */
interface Running {
  readonly child: UtilityProcess;
  readonly runs: WantedBackend;
  /** The plugin's `start` returned. */
  ready: boolean;
  /** Main asked it to exit, so its exit isn't a crash. */
  stopping: boolean;
  /**
   * The crash reason: the first line of the host's `[fatal]` report, or else the last line the
   * backend wrote to stderr.
   */
  lastError: string;
  fatal: boolean;
  readonly exited: Promise<void>;
}

/** Main's record of one plugin's backend. */
interface Slot {
  readonly id: string;
  /** From the last reconcile. Undefined: it shouldn't run (disabled, removed, no backend). */
  wanted: WantedBackend | undefined;
  running: Running | undefined;
  /** Crash times within the crash window, oldest first. */
  crashes: Array<number>;
  /** A restart waiting for its backoff delay. */
  retry: { readonly timer: ReturnType<typeof setTimeout>; readonly at: number } | undefined;
  /** It crashed too often, and stays down until a retry or the next enable. */
  failed: string | undefined;
  lastCrash: string;
  /** Updates and removes in progress, which keep it stopped while they replace its files. */
  holds: number;
  /** The last status sent to pages, to send only changes. */
  sent: string;
}

export const BackendActionSchema = Schema.Union([
  Schema.TaggedStruct("subscribe", {}),
  Schema.TaggedStruct("send", { plugin: PluginIdSchema, data: Schema.Unknown }),
  Schema.TaggedStruct("retry", { plugin: PluginIdSchema }),
]);

export class Backends extends Context.Service<
  Backends,
  {
    /** Runs exactly these backends: starts, stops and restarts to match. */
    readonly apply: (wanted: ReadonlyArray<WantedBackend>) => Effect.Effect<void>;
    /** Stops a plugin's backend and keeps it stopped until `release`, waiting for it to exit. */
    readonly hold: (id: string) => Effect.Effect<void>;
    readonly release: (id: string) => Effect.Effect<void>;
    /** A BackendAction from the page. */
    readonly act: (
      input: unknown,
      sender: WebContents,
    ) => Effect.Effect<unknown, Schema.SchemaError>;
    /** Kills every backend now and starts none again. For quitting. */
    readonly stopAll: Effect.Effect<void>;
  }
>()("@t3mode/main/Backends") {}

/** A log over this size is moved to `<id>.old.log` when the backend starts. */
const MAX_LOG_BYTES = 2 * 1024 * 1024;
/** How the backend host starts its report of an error the plugin left uncaught. */
const FATAL_PREFIX = "[fatal] ";
/** How long `hold` waits for a backend to exit. */
const EXIT_TIMEOUT_MS = 5_000;

const statusOf = (slot: Slot): BackendStatus | null => {
  if (slot.running) return { state: slot.running.ready ? "running" : "starting" };
  if (slot.failed !== undefined) {
    return { state: "failed", crashes: slot.crashes.length, error: slot.failed };
  }
  if (slot.retry) {
    return {
      state: "restarting",
      crashes: slot.crashes.length,
      error: slot.lastCrash,
      retryAt: slot.retry.at,
    };
  }
  return null;
};

const kill = (running: Running) => {
  running.stopping = true;
  running.child.kill();
};

const sameBackend = (a: WantedBackend, b: WantedBackend) =>
  a.script === b.script && a.folder === b.folder && a.version === b.version;

export const make = Effect.gen(function* () {
  const { layout } = yield* Home;
  const run = Effect.runForkWith(yield* Effect.context<never>());
  const slots = new Map<string, Slot>();
  const pages = new Set<WebContents>();
  let quitting = false;

  const slotOf = (id: string): Slot => {
    let slot = slots.get(id);
    if (!slot) {
      slot = {
        id,
        wanted: undefined,
        running: undefined,
        crashes: [],
        retry: undefined,
        failed: undefined,
        lastCrash: "",
        holds: 0,
        sent: "null",
      };
      slots.set(id, slot);
    }
    return slot;
  };

  const broadcast = (event: BackendEvent) => {
    for (const page of pages) {
      if (page.isDestroyed()) pages.delete(page);
      else page.send(Channel.backendEvent, event);
    }
  };

  const emit = (slot: Slot) => {
    const status = statusOf(slot);
    const text = JSON.stringify(status);
    if (text === slot.sent) return;
    slot.sent = text;
    broadcast({ _tag: "status", plugin: slot.id, status });
  };

  const openLog = (id: string) => {
    const file = NodePath.join(layout.pluginLogs, `${id}.log`);
    NodeFs.mkdirSync(layout.pluginLogs, { recursive: true });
    try {
      if (NodeFs.statSync(file).size > MAX_LOG_BYTES) {
        NodeFs.renameSync(file, NodePath.join(layout.pluginLogs, `${id}.old.log`));
      }
    } catch {
      // No log yet.
    }
    const stream = NodeFs.createWriteStream(file, { flags: "a" });
    stream.on("error", () => undefined);
    return (line: string) => stream.write(`${new Date().toISOString()} ${line}\n`);
  };

  const start = (slot: Slot, wanted: WantedBackend) => {
    const write = openLog(slot.id);
    const dataDir = NodePath.join(layout.pluginData, slot.id);
    NodeFs.mkdirSync(dataDir, { recursive: true });
    const child = utilityProcess.fork(layout.backendHost, [wanted.script], {
      serviceName: `t3mode plugin ${slot.id}`,
      stdio: "pipe",
      cwd: wanted.folder,
      env: {
        ...process.env,
        [BackendEnv.plugin]: slot.id,
        [BackendEnv.script]: wanted.script,
        [BackendEnv.data]: dataDir,
      },
    });
    const exited = Promise.withResolvers<void>();
    const running: Running = {
      child,
      runs: wanted,
      ready: false,
      stopping: false,
      lastError: "",
      fatal: false,
      exited: exited.promise,
    };
    slot.running = running;
    write(`starting ${wanted.script}`);
    for (const [stream, prefix] of [
      [child.stdout, ""],
      [child.stderr, "stderr "],
    ] as const) {
      if (!stream) continue;
      NodeReadline.createInterface({ input: stream }).on("line", (line) => {
        write(`${prefix}${line}`);
        if (prefix === "" || line.trim() === "" || running.fatal) return;
        running.fatal = line.startsWith(FATAL_PREFIX);
        running.lastError = running.fatal ? line.slice(FATAL_PREFIX.length) : line;
      });
    }
    child.on("spawn", () => write(`started, pid ${child.pid ?? "unknown"}`));
    child.on("message", (message: FromBackendHost) => {
      if (slot.running !== running || typeof message !== "object" || message === null) return;
      if (message._tag === "ready") {
        running.ready = true;
        emit(slot);
      } else if (message._tag === "message") {
        broadcast({ _tag: "message", plugin: slot.id, data: message.data });
      }
    });
    child.on("exit", (code) => {
      write(`exited with code ${code}`);
      exited.resolve();
      if (slot.running !== running) return;
      slot.running = undefined;
      if (!running.stopping && !quitting)
        crashed(slot, running.lastError || `exited with code ${code}`);
      settle(slot);
    });
    emit(slot);
  };

  const crashed = (slot: Slot, error: string) => {
    const now = Date.now();
    slot.crashes = [...slot.crashes.filter((at) => now - at < BACKEND_CRASH_WINDOW_MS), now];
    slot.lastCrash = error;
    if (slot.crashes.length >= BACKEND_MAX_CRASHES) {
      slot.failed = error;
      run(
        Effect.logError(
          `Backend of ${slot.id} crashed ${slot.crashes.length} times; it stays stopped`,
          { error },
        ),
      );
      return;
    }
    const delay = backendRetryDelay(slot.crashes.length);
    run(Effect.logWarning(`Backend of ${slot.id} crashed; restarting in ${delay} ms`, { error }));
    slot.retry = {
      at: now + delay,
      timer: setTimeout(() => {
        slot.retry = undefined;
        settle(slot);
      }, delay),
    };
  };

  /** Brings one slot in line with what is wanted, then tells the pages. */
  const settle = (slot: Slot) => {
    const { wanted, running } = slot;
    if (!wanted) {
      if (slot.retry) clearTimeout(slot.retry.timer);
      slot.retry = undefined;
      slot.failed = undefined;
      slot.crashes = [];
    }
    if (running) {
      const keep = wanted && slot.holds === 0 && !quitting && sameBackend(running.runs, wanted);
      if (!keep && !running.stopping) kill(running);
    } else if (
      wanted &&
      slot.holds === 0 &&
      !quitting &&
      slot.failed === undefined &&
      slot.retry === undefined
    ) {
      try {
        start(slot, wanted);
      } catch (error) {
        crashed(slot, `could not start: ${String(error)}`);
      }
    }
    emit(slot);
  };

  const apply = Effect.fn("Backends.apply")(function* (wanted: ReadonlyArray<WantedBackend>) {
    yield* Effect.sync(() => {
      if (!app.isReady()) return;
      const byId = new Map(wanted.map((backend) => [backend.id, backend]));
      for (const id of byId.keys()) slotOf(id);
      for (const slot of slots.values()) {
        const next = byId.get(slot.id);
        // A new version starts with a clean crash record.
        if (next && slot.wanted && !sameBackend(next, slot.wanted)) {
          slot.failed = undefined;
          slot.crashes = [];
        }
        slot.wanted = next;
        settle(slot);
      }
    });
  });

  const hold = Effect.fn("Backends.hold")(function* (id: string) {
    const running = yield* Effect.sync(() => {
      const slot = slotOf(id);
      slot.holds++;
      const current = slot.running;
      settle(slot);
      return current;
    });
    if (!running) return;
    yield* Effect.promise(() =>
      Promise.race([
        running.exited,
        new Promise((resolve) => setTimeout(resolve, EXIT_TIMEOUT_MS)),
      ]),
    );
  });

  // The files changed or are gone: the next reconcile says what runs now.
  const release = Effect.fn("Backends.release")(function* (id: string) {
    yield* Effect.sync(() => {
      const slot = slotOf(id);
      slot.holds = Math.max(0, slot.holds - 1);
      if (slot.holds === 0) slot.wanted = undefined;
      settle(slot);
    });
  });

  const act = Effect.fn("Backends.act")(function* (input: unknown, sender: WebContents) {
    const action = yield* Schema.decodeUnknownEffect(BackendActionSchema)(input);
    return yield* Effect.sync(() => {
      switch (action._tag) {
        case "subscribe": {
          pages.add(sender);
          for (const slot of slots.values()) {
            const status = statusOf(slot);
            if (status)
              sender.send(Channel.backendEvent, { _tag: "status", plugin: slot.id, status });
          }
          return true;
        }
        case "send": {
          const running = slots.get(action.plugin)?.running;
          if (!running || running.stopping) return false;
          // A utility process's port, not a window: there is no origin to name.
          // eslint-disable-next-line unicorn/require-post-message-target-origin
          running.child.postMessage({ _tag: "message", data: action.data } satisfies ToBackendHost);
          return true;
        }
        case "retry": {
          const slot = slotOf(action.plugin);
          if (slot.retry) clearTimeout(slot.retry.timer);
          slot.retry = undefined;
          slot.failed = undefined;
          slot.crashes = [];
          settle(slot);
          return true;
        }
      }
    });
  });

  const stopAll = Effect.gen(function* () {
    const stopped = yield* Effect.sync(() => {
      quitting = true;
      let count = 0;
      for (const slot of slots.values()) {
        if (slot.retry) clearTimeout(slot.retry.timer);
        slot.retry = undefined;
        if (slot.running && !slot.running.stopping) {
          kill(slot.running);
          count++;
        }
      }
      return count;
    });
    if (stopped > 0) yield* Effect.logInfo(`Stopped ${stopped} plugin backend(s) for quit`);
  });

  return Backends.of({ apply, hold, release, act, stopAll });
});

export const layer = Layer.effect(Backends, make);
