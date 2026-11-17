// The backend host's side of the desktop indicator (see "Desktop indicator" in
// docs/architecture.md). Main owns the window; this module owns presence: it probes the window,
// accepts only the answer to the latest probe, and lets a proof count for 3 s from when the probe
// was sent, so answers delayed in a stalled main never extend it.
// @effect-diagnostics globalTimers:off - a plain Node program, outside Effect
import type {
  BackendIndicator,
  DrivingIndicator,
  IndicatorModel,
  ScreenRect,
} from "@t3mode/plugin-sdk";
import {
  type IndicatorReply,
  type IndicatorRequest,
  clipIndicatorText,
} from "@t3mode/shared/Backends";

export const PROBE_EVERY_MS = 750;
export const PROOF_LASTS_MS = 3_000;
export const SHOW_TIMEOUT_MS = 3_000;
export const WATCHDOG_MS = 100;

export interface IndicatorPort {
  readonly send: (request: IndicatorRequest) => void;
  /** A monotonic clock in milliseconds. */
  readonly now: () => number;
}

export interface HostIndicator extends BackendIndicator {
  readonly receive: (reply: IndicatorReply) => void;
}

type EndReason = "stop" | "unavailable";

/** One `show` until its handle closes. */
interface Shown {
  readonly id: number;
  readonly controller: AbortController;
  readonly startedAt: number;
  readonly timers: ReadonlyArray<ReturnType<typeof setInterval>>;
  readonly settle: {
    readonly resolve: (handle: DrivingIndicator) => void;
    readonly reject: (error: Error) => void;
  };
  phase:
    | { readonly kind: "waiting" }
    | { readonly kind: "live"; readonly rect: ScreenRect; deadline: number }
    /** The user pressed Stop. The pill says "Stopping…" until the plugin closes the handle. */
    | { readonly kind: "stopped" };
  probe: { readonly n: number; readonly sentAt: number } | undefined;
}

const parseModel = (model: unknown): IndicatorModel => {
  const { label, detail } = (model ?? {}) as Partial<IndicatorModel>;
  if (typeof label !== "string" || (detail !== null && typeof detail !== "string")) {
    throw new TypeError("show takes { label: string, detail: string | null }.");
  }
  return {
    label: clipIndicatorText(label),
    detail: detail === null ? null : clipIndicatorText(detail),
  };
};

const parseDetail = (detail: unknown): string | null => {
  if (detail !== null && typeof detail !== "string") {
    throw new TypeError("setDetail takes a string or null.");
  }
  return detail === null ? null : clipIndicatorText(detail);
};

const sameRect = (a: ScreenRect, b: ScreenRect) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export const makeIndicator = ({ send, now }: IndicatorPort): HostIndicator => {
  let ids = 0;
  let probes = 0;
  let current: Shown | undefined;

  const release = (shown: Shown) => {
    for (const timer of shown.timers) clearInterval(timer);
    shown.probe = undefined;
  };

  const forget = (shown: Shown) => {
    release(shown);
    if (current === shown) current = undefined;
  };

  const end = (shown: Shown, reason: EndReason) => {
    const error = new Error(reason);
    if (shown.phase.kind === "waiting") {
      send({ op: "close", id: shown.id });
      forget(shown);
      shown.settle.reject(error);
    } else if (reason === "stop") {
      shown.phase = { kind: "stopped" };
      release(shown);
      shown.controller.abort(error);
    } else {
      send({ op: "close", id: shown.id });
      forget(shown);
      shown.controller.abort(error);
    }
  };

  const probe = (shown: Shown) => {
    const n = ++probes;
    shown.probe = { n, sentAt: now() };
    send({ op: "probe", id: shown.id, n });
  };

  const watch = (shown: Shown) => {
    const { phase } = shown;
    if (phase.kind === "waiting" && now() - shown.startedAt >= SHOW_TIMEOUT_MS) {
      end(shown, "unavailable");
    } else if (phase.kind === "live" && now() > phase.deadline) {
      end(shown, "unavailable");
    }
  };

  const handleOf = (shown: Shown, rect: ScreenRect): DrivingIndicator =>
    Object.freeze({
      signal: shown.controller.signal,
      rect,
      live: () =>
        current === shown &&
        shown.phase.kind === "live" &&
        !shown.controller.signal.aborted &&
        now() <= shown.phase.deadline,
      setDetail: (detail: string | null) => {
        const parsed = parseDetail(detail);
        if (current === shown && shown.phase.kind === "live") {
          send({ op: "detail", id: shown.id, detail: parsed });
        }
      },
      close: () => {
        if (current !== shown) return;
        send({ op: "close", id: shown.id });
        forget(shown);
      },
    });

  const painted = (shown: Shown, n: number, rect: ScreenRect) => {
    const sent = shown.probe;
    if (!sent || sent.n !== n || shown.phase.kind === "stopped") return;
    shown.probe = undefined;
    const deadline = sent.sentAt + PROOF_LASTS_MS;
    if (now() > deadline) return;
    if (shown.phase.kind === "live") {
      if (sameRect(shown.phase.rect, rect)) shown.phase.deadline = deadline;
      else end(shown, "unavailable");
      return;
    }
    const fixed = Object.freeze({ ...rect });
    shown.phase = { kind: "live", rect: fixed, deadline };
    shown.settle.resolve(handleOf(shown, fixed));
  };

  return {
    show: (model) => {
      if (current) return Promise.reject(new Error("An indicator is already shown."));
      let parsed: IndicatorModel;
      try {
        parsed = parseModel(model);
      } catch (error) {
        return Promise.reject(error as Error);
      }
      const { promise, resolve, reject } = Promise.withResolvers<DrivingIndicator>();
      const id = ++ids;
      const timers: Array<ReturnType<typeof setInterval>> = [];
      const shown: Shown = {
        id,
        controller: new AbortController(),
        startedAt: now(),
        timers,
        settle: { resolve, reject },
        phase: { kind: "waiting" },
        probe: undefined,
      };
      current = shown;
      send({ op: "show", id, label: parsed.label, detail: parsed.detail });
      probe(shown);
      timers.push(
        setInterval(() => probe(shown), PROBE_EVERY_MS),
        setInterval(() => watch(shown), WATCHDOG_MS),
      );
      return promise;
    },
    receive: (reply) => {
      const shown = current;
      if (!shown || reply.id !== shown.id) return;
      if (reply.op === "painted") painted(shown, reply.n, reply.rect);
      else if (shown.phase.kind !== "stopped") end(shown, reply.reason);
    },
  };
};
