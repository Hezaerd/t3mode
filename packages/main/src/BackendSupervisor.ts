// The rules for plugin backends, without Electron (see "Backends" in docs/architecture.md). The
// reconcile tells `apply` which backends should run; the supervisor starts, stops and restarts
// them, carries messages between each one and the pages, and writes each one's output to its log.
// It routes by the plugin id of the process it started. Backends.ts gives it Electron's
// utilityProcess; tests give it a fake child.
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off - driven by process events, outside any fiber
// @effect-diagnostics globalTimers:off - restart delays outlive the calls that set them
import * as NodeReadline from "node:readline";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  BACKEND_CRASH_WINDOW_MS,
  BACKEND_MAX_CRASHES,
  type BackendEvent,
  type BackendStatus,
  type FromBackendHost,
  type IndicatorReply,
  type ToBackendHost,
  backendRetryDelay,
} from "@t3mode/shared/Backends";
import { Channel } from "@t3mode/shared/Ipc";
import { PluginIdSchema } from "@t3mode/shared/PluginStore";

import type { BackendLogWriter } from "./BackendLog.ts";

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

/** A started backend process, as the supervisor uses it. */
export interface BackendProcess {
  readonly pid: () => number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  readonly postMessage: (message: ToBackendHost) => void;
  readonly kill: () => void;
  readonly onSpawn: (listener: () => void) => void;
  readonly onMessage: (listener: (message: unknown) => void) => void;
  readonly onExit: (listener: (code: number) => void) => void;
}

/** A page that follows the backends: T3 Code's window. */
export interface BackendPage {
  readonly isDestroyed: () => boolean;
  readonly send: (channel: string, event: BackendEvent) => void;
}

/** One backend process, as its desktop indicator sees it. */
export interface BackendOwner {
  readonly plugin: string;
  /** Dropped once this process is no longer the plugin's running backend. */
  readonly reply: (reply: IndicatorReply) => void;
}

/** The desktop indicators (DesktopIndicator.ts). The supervisor names the owner of each request. */
export interface IndicatorHooks {
  /** An unvalidated request from the owner's backend host. */
  readonly request: (owner: BackendOwner, request: unknown) => void;
  /** Destroys the owner's window. Called before a backend is asked to exit, and when it exits. */
  readonly dispose: (owner: BackendOwner) => void;
}

export interface SupervisorOptions {
  /** Starts the backend's process. A throw counts as a crash. */
  readonly spawn: (wanted: WantedBackend) => BackendProcess;
  readonly openLog: (id: string) => BackendLogWriter;
  /** Processes can start only after Electron's app ready. */
  readonly isReady: () => boolean;
  /** How long `hold` waits for a backend to exit. */
  readonly exitTimeoutMs?: number;
  readonly indicator: IndicatorHooks;
}

export interface Supervisor {
  /** Runs exactly these backends: starts, stops and restarts to match. */
  readonly apply: (wanted: ReadonlyArray<WantedBackend>) => Effect.Effect<void>;
  /**
   * Stops a plugin's backend and keeps it stopped until `release`, waiting for it to exit. False
   * when it was still running after the wait.
   */
  readonly hold: (id: string) => Effect.Effect<boolean>;
  /** Ends a hold. The backend stays down until the next `apply`, since its files changed. */
  readonly release: (id: string) => Effect.Effect<void>;
  /** A BackendAction from the page. */
  readonly act: (input: unknown, sender: BackendPage) => Effect.Effect<unknown, Schema.SchemaError>;
  /** Kills every backend now and starts none again. For quitting. */
  readonly stopAll: Effect.Effect<void>;
  /** The reconcile to run before a restart: it checks the plugin's files again and calls `apply`. */
  readonly setRecheck: (recheck: Effect.Effect<void>) => void;
}

export const BackendActionSchema = Schema.Union([
  Schema.TaggedStruct("subscribe", {}),
  Schema.TaggedStruct("send", { plugin: PluginIdSchema, data: Schema.Unknown }),
  Schema.TaggedStruct("retry", { plugin: PluginIdSchema }),
]);

/** How the backend host starts its report of an error the plugin left uncaught. */
const FATAL_PREFIX = "[fatal] ";
export const BACKEND_EXIT_TIMEOUT_MS = 5_000;

/** A backend process the supervisor started, and what it runs. */
interface Running {
  readonly child: BackendProcess;
  readonly owner: BackendOwner;
  readonly runs: WantedBackend;
  /** The plugin's `start` returned. */
  ready: boolean;
  /** The supervisor asked it to exit, so its exit isn't a crash. */
  stopping: boolean;
  /**
   * The crash reason: the first line of the host's `[fatal]` report, or else the last line the
   * backend wrote to stderr.
   */
  lastError: string;
  fatal: boolean;
  readonly exited: Promise<void>;
}

/** The supervisor's record of one plugin's backend. */
interface Slot {
  readonly id: string;
  /** From the last reconcile. Undefined: it shouldn't run (disabled, removed, no backend). */
  wanted: WantedBackend | undefined;
  /**
   * A reconcile checked `wanted` since the backend last stopped. A restart after a crash or a
   * Retry waits for one, so it never runs files that changed on disk since their pins were checked.
   */
  checked: boolean;
  running: Running | undefined;
  /** Crash times within the crash window, oldest first. */
  crashes: Array<number>;
  /** A restart waiting for its backoff delay. */
  retry: { readonly timer: ReturnType<typeof setTimeout>; readonly at: number } | undefined;
  /** It crashed too often, and stays down until a retry or a new version. */
  failed: string | undefined;
  lastCrash: string;
  /** Updates and removes in progress, which keep it stopped while they replace its files. */
  holds: number;
  /** The last status sent to pages, to send only changes. */
  sent: string;
}

const statusOf = (slot: Slot): BackendStatus | null => {
  if (slot.running) return { state: slot.running.ready ? "running" : "starting" };
  if (slot.wanted && !slot.checked && slot.holds === 0) return { state: "starting" };
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

const sameBackend = (a: WantedBackend, b: WantedBackend) =>
  a.script === b.script && a.folder === b.folder && a.version === b.version;

export const makeSupervisor = Effect.fnUntraced(function* (options: SupervisorOptions) {
  const run = Effect.runForkWith(yield* Effect.context<never>());
  const exitTimeoutMs = options.exitTimeoutMs ?? BACKEND_EXIT_TIMEOUT_MS;
  const slots = new Map<string, Slot>();
  const pages = new Set<BackendPage>();
  let quitting = false;
  let recheck: Effect.Effect<void> = Effect.void;

  const slotOf = (id: string): Slot => {
    let slot = slots.get(id);
    if (!slot) {
      slot = {
        id,
        wanted: undefined,
        checked: false,
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

  const kill = (running: Running) => {
    running.stopping = true;
    options.indicator.dispose(running.owner);
    running.child.kill();
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

  /** Starts this slot again once a reconcile has checked its files. */
  const restart = (slot: Slot) => {
    slot.checked = false;
    emit(slot);
    run(recheck);
  };

  const start = (slot: Slot, wanted: WantedBackend) => {
    const log = options.openLog(slot.id);
    let child: BackendProcess;
    try {
      child = options.spawn(wanted);
    } catch (error) {
      log.write(`could not start: ${String(error)}`);
      log.close();
      throw error;
    }
    const exited = Promise.withResolvers<void>();
    const running: Running = {
      child,
      owner: {
        plugin: slot.id,
        reply: (reply) => {
          if (slot.running !== running || running.stopping) return;
          // The child's own port, not a window: there is no origin to name.
          // eslint-disable-next-line unicorn/require-post-message-target-origin
          child.postMessage({ _tag: "indicator", reply });
        },
      },
      runs: wanted,
      ready: false,
      stopping: false,
      lastError: "",
      fatal: false,
      exited: exited.promise,
    };
    slot.running = running;
    log.write(`starting ${wanted.script}`);
    // The log closes once the process has exited and its pipes have drained.
    let open = 1;
    const closeOne = () => {
      open--;
      if (open === 0) log.close();
    };
    for (const [stream, prefix] of [
      [child.stdout, ""],
      [child.stderr, "stderr "],
    ] as const) {
      if (!stream) continue;
      open++;
      const lines = NodeReadline.createInterface({ input: stream });
      lines.on("close", closeOne);
      lines.on("line", (line) => {
        log.write(`${prefix}${line}`);
        if (prefix === "" || line.trim() === "" || running.fatal) return;
        running.fatal = line.startsWith(FATAL_PREFIX);
        running.lastError = running.fatal ? line.slice(FATAL_PREFIX.length) : line;
      });
    }
    child.onSpawn(() => log.write(`started, pid ${child.pid() ?? "unknown"}`));
    child.onMessage((input) => {
      const message = input as FromBackendHost | null;
      if (slot.running !== running || typeof message !== "object" || message === null) return;
      if (message._tag === "ready") {
        running.ready = true;
        emit(slot);
      } else if (message._tag === "message") {
        broadcast({ _tag: "message", plugin: slot.id, data: message.data });
      } else if (message._tag === "indicator" && !running.stopping) {
        options.indicator.request(running.owner, message.request);
      }
    });
    child.onExit((code) => {
      log.write(`exited with code ${code}`);
      // Main may be quitting, and then no later turn runs to write it.
      log.flush();
      closeOne();
      exited.resolve();
      options.indicator.dispose(running.owner);
      if (slot.running !== running) return;
      slot.running = undefined;
      if (!running.stopping && !quitting) {
        crashed(slot, running.lastError || `exited with code ${code}`);
      }
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
        restart(slot);
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
      slot.checked &&
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
      if (!options.isReady()) return;
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
        slot.checked = next !== undefined;
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
    if (!running) return true;
    return yield* Effect.promise(() =>
      Promise.race([
        running.exited.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), exitTimeoutMs)),
      ]),
    );
  });

  const release = Effect.fn("Backends.release")(function* (id: string) {
    yield* Effect.sync(() => {
      const slot = slotOf(id);
      slot.holds = Math.max(0, slot.holds - 1);
      if (slot.holds === 0) {
        slot.wanted = undefined;
        slot.checked = false;
      }
      settle(slot);
    });
  });

  const act = Effect.fn("Backends.act")(function* (input: unknown, sender: BackendPage) {
    const action = yield* Schema.decodeUnknownEffect(BackendActionSchema)(input);
    return yield* Effect.sync(() => {
      switch (action._tag) {
        case "subscribe": {
          pages.add(sender);
          for (const slot of slots.values()) {
            const status = statusOf(slot);
            if (status) {
              sender.send(Channel.backendEvent, { _tag: "status", plugin: slot.id, status });
            }
          }
          return true;
        }
        case "send": {
          const running = slots.get(action.plugin)?.running;
          if (!running || running.stopping) return false;
          // The child's own port, not a window: there is no origin to name.
          // eslint-disable-next-line unicorn/require-post-message-target-origin
          running.child.postMessage({ _tag: "message", data: action.data });
          return true;
        }
        case "retry": {
          const slot = slotOf(action.plugin);
          if (slot.retry) clearTimeout(slot.retry.timer);
          slot.retry = undefined;
          slot.failed = undefined;
          slot.crashes = [];
          restart(slot);
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

  return {
    apply,
    hold,
    release,
    act,
    stopAll,
    setRecheck: (next) => {
      recheck = next;
    },
  } satisfies Supervisor;
});
