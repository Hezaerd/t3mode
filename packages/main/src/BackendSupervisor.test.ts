import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { BACKEND_CRASH_WINDOW_MS, type BackendEvent } from "@t3mode/shared/Backends";

import {
  BACKEND_EXIT_TIMEOUT_MS,
  type BackendProcess,
  type WantedBackend,
  makeSupervisor,
} from "./BackendSupervisor.ts";

/** A backend process that does what the test tells it to. */
class FakeChild implements BackendProcess {
  readonly stdout = null;
  readonly stderr = null;
  readonly received: Array<unknown> = [];
  killed = 0;
  /** Whether kill() ends the process, as a real one does. */
  exitsOnKill = true;
  exitedWith: number | undefined;
  readonly #message: Array<(message: unknown) => void> = [];
  readonly #exit: Array<(code: number) => void> = [];

  readonly runs: WantedBackend;

  constructor(runs: WantedBackend) {
    this.runs = runs;
  }

  pid = () => 1;
  postMessage = (message: unknown) => {
    this.received.push(message);
  };
  kill = () => {
    this.killed++;
    if (this.exitsOnKill) queueMicrotask(() => this.exit(0));
  };
  onSpawn = () => undefined;
  onMessage = (listener: (message: unknown) => void) => {
    this.#message.push(listener);
  };
  onExit = (listener: (code: number) => void) => {
    this.#exit.push(listener);
  };

  /** The host finished the plugin's `start`. */
  ready() {
    for (const listener of this.#message) listener({ _tag: "ready" });
  }
  say(data: unknown) {
    for (const listener of this.#message) listener({ _tag: "message", data });
  }
  exit(code: number) {
    if (this.exitedWith !== undefined) return;
    this.exitedWith = code;
    for (const listener of this.#exit) listener(code);
  }
}

const backend = (version = "1"): WantedBackend => ({
  id: "demo",
  folder: "C:\\plugins\\demo",
  script: "C:\\plugins\\demo\\backend.cjs",
  version,
});

const setup = () => {
  const children: Array<FakeChild> = [];
  const events: Array<BackendEvent> = [];
  let rechecks = 0;
  const supervisor = Effect.runSync(
    makeSupervisor({
      spawn: (wanted) => {
        const child = new FakeChild(wanted);
        children.push(child);
        return child;
      },
      openLog: () => ({ write: () => undefined, flush: () => undefined, close: () => undefined }),
      isReady: () => true,
    }),
  );
  supervisor.setRecheck(
    Effect.sync(() => {
      rechecks++;
    }),
  );
  Effect.runSync(
    supervisor.act(
      { _tag: "subscribe" },
      { isDestroyed: () => false, send: (_channel, event) => events.push(event) },
    ),
  );
  const status = () => {
    const event = events.findLast((item) => item._tag === "status" && item.plugin === "demo");
    return event?._tag === "status" ? event.status : null;
  };
  return {
    supervisor,
    children,
    events,
    status,
    rechecks: () => rechecks,
    apply: (...wanted: Array<WantedBackend>) => Effect.runSync(supervisor.apply(wanted)),
    last: () => children.at(-1)!,
  };
};

/** Two crashes, each restarted by the reconcile after its delay, then a third: failed. */
const crashUntilFailed = async (t: ReturnType<typeof setup>, version = "1") => {
  t.last().exit(1);
  await vi.advanceTimersByTimeAsync(1_000);
  t.apply(backend(version));
  t.last().exit(1);
  await vi.advanceTimersByTimeAsync(2_000);
  t.apply(backend(version));
  t.last().exit(1);
};

/** Lets queued microtasks run, such as a fake child's exit after kill(). */
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("crashes", () => {
  it("restarts after a reconcile twice, then leaves the third crash failed", async () => {
    const t = setup();
    t.apply(backend());
    expect(t.children).toHaveLength(1);
    t.last().ready();
    expect(t.status()).toEqual({ state: "running" });

    t.last().exit(3);
    expect(t.status()).toMatchObject({ state: "restarting", crashes: 1 });
    await vi.advanceTimersByTimeAsync(999);
    expect(t.rechecks()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.rechecks()).toBe(1);
    // Waits for the reconcile.
    expect(t.children).toHaveLength(1);
    expect(t.status()).toEqual({ state: "starting" });
    t.apply(backend());
    expect(t.children).toHaveLength(2);

    t.last().exit(3);
    expect(t.status()).toMatchObject({ state: "restarting", crashes: 2 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.rechecks()).toBe(2);
    t.apply(backend());
    expect(t.children).toHaveLength(3);

    t.last().exit(3);
    expect(t.status()).toEqual({ state: "failed", crashes: 3, error: "exited with code 3" });
    await vi.advanceTimersByTimeAsync(60_000);
    t.apply(backend());
    expect(t.children).toHaveLength(3);
    expect(t.rechecks()).toBe(2);
  });

  it("forgets crashes older than the window", async () => {
    const t = setup();
    t.apply(backend());
    t.last().exit(1);
    await vi.advanceTimersByTimeAsync(1_000);
    t.apply(backend());
    t.last().exit(1);
    await vi.advanceTimersByTimeAsync(2_000);
    t.apply(backend());
    await vi.advanceTimersByTimeAsync(BACKEND_CRASH_WINDOW_MS);
    t.last().exit(1);
    // Two crashes are past the window, so this one is the first again.
    expect(t.status()).toMatchObject({ state: "restarting", crashes: 1 });
  });

  it("restarts after Retry through a reconcile", async () => {
    const t = setup();
    t.apply(backend());
    await crashUntilFailed(t);
    expect(t.status()).toMatchObject({ state: "failed" });
    Effect.runSync(t.supervisor.act({ _tag: "retry", plugin: "demo" }, undefined as never));
    expect(t.rechecks()).toBe(3);
    expect(t.children).toHaveLength(3);
    t.apply(backend());
    expect(t.children).toHaveLength(4);
  });

  it("doesn't restart when the reconcile no longer wants it", async () => {
    const t = setup();
    t.apply(backend());
    t.last().exit(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.rechecks()).toBe(1);
    // The files changed on disk, so the reconcile leaves it out.
    t.apply();
    expect(t.children).toHaveLength(1);
    expect(t.status()).toBeNull();
  });
});

describe("hold and release", () => {
  it("kills the backend, keeps it down through an apply, and leaves it for the next apply", async () => {
    const t = setup();
    t.apply(backend());
    const first = t.last();
    const held = Effect.runPromise(t.supervisor.hold("demo"));
    expect(first.killed).toBe(1);
    await flush();
    expect(await held).toBe(true);
    // An exit main asked for isn't a crash.
    expect(t.status()).toBeNull();

    t.apply(backend());
    expect(t.children).toHaveLength(1);

    Effect.runSync(t.supervisor.release("demo"));
    expect(t.children).toHaveLength(1);
    t.apply(backend("2"));
    expect(t.children).toHaveLength(2);
    expect(t.last().runs.version).toBe("2");
  });

  it("reports false when the backend doesn't exit in time", async () => {
    const t = setup();
    t.apply(backend());
    t.last().exitsOnKill = false;
    const held = Effect.runPromise(t.supervisor.hold("demo"));
    await vi.advanceTimersByTimeAsync(BACKEND_EXIT_TIMEOUT_MS - 1);
    let done = false;
    void held.then(() => {
      done = true;
    });
    await flush();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await held).toBe(false);
  });
});

describe("versions", () => {
  it("restarts once on a new version", async () => {
    const t = setup();
    t.apply(backend("1"));
    t.apply(backend("1"));
    expect(t.children).toHaveLength(1);
    t.apply(backend("2"));
    expect(t.children[0]!.killed).toBe(1);
    await flush();
    expect(t.children).toHaveLength(2);
    expect(t.last().runs.version).toBe("2");
    t.apply(backend("2"));
    expect(t.children).toHaveLength(2);
  });

  it("clears a failed state", async () => {
    const t = setup();
    t.apply(backend("1"));
    await crashUntilFailed(t);
    expect(t.status()).toMatchObject({ state: "failed" });
    t.apply(backend("2"));
    expect(t.children).toHaveLength(4);
    t.last().ready();
    expect(t.status()).toEqual({ state: "running" });
  });
});

describe("stopAll", () => {
  it("kills every backend, and an exit after it is no crash and starts nothing", async () => {
    const t = setup();
    t.apply(backend());
    t.last().exitsOnKill = false;
    Effect.runSync(t.supervisor.stopAll);
    expect(t.last().killed).toBe(1);
    t.last().exit(1);
    expect(t.status()).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.rechecks()).toBe(0);
    t.apply(backend("2"));
    expect(t.children).toHaveLength(1);
  });

  it("cancels a pending restart", async () => {
    const t = setup();
    t.apply(backend());
    t.last().exit(1);
    Effect.runSync(t.supervisor.stopAll);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.rechecks()).toBe(0);
    expect(t.children).toHaveLength(1);
  });
});

describe("messages", () => {
  it("carries page messages to the plugin's own process and back under its id", () => {
    const t = setup();
    expect(
      Effect.runSync(
        t.supervisor.act({ _tag: "send", plugin: "demo", data: "early" }, undefined as never),
      ),
    ).toBe(false);
    t.apply(backend());
    expect(
      Effect.runSync(
        t.supervisor.act({ _tag: "send", plugin: "demo", data: { n: 1 } }, undefined as never),
      ),
    ).toBe(true);
    expect(t.last().received).toEqual([{ _tag: "message", data: { n: 1 } }]);
    t.last().say("pong");
    expect(t.events.at(-1)).toEqual({ _tag: "message", plugin: "demo", data: "pong" });
  });

  it("counts a spawn that throws as a crash", () => {
    const events: Array<BackendEvent> = [];
    const supervisor = Effect.runSync(
      makeSupervisor({
        spawn: () => {
          throw new Error("no exe");
        },
        openLog: () => ({ write: () => undefined, flush: () => undefined, close: () => undefined }),
        isReady: () => true,
      }),
    );
    Effect.runSync(
      supervisor.act(
        { _tag: "subscribe" },
        { isDestroyed: () => false, send: (_channel, event) => events.push(event) },
      ),
    );
    Effect.runSync(supervisor.apply([backend()]));
    expect(events.at(-1)).toMatchObject({
      _tag: "status",
      status: { state: "restarting", crashes: 1, error: "could not start: Error: no exe" },
    });
  });
});
