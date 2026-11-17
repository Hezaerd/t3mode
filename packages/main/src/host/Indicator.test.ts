// @effect-diagnostics globalDate:off globalTimers:off - fake timers drive the host's plain clock
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { DrivingIndicator } from "@t3mode/plugin-sdk";
import type { IndicatorRequest, ScreenRect } from "@t3mode/shared/Backends";

import { makeIndicator } from "./Indicator.ts";

const RECT: ScreenRect = { x: 720, y: 12, width: 480, height: 44 };

/** The host's indicator, with main played by the test. */
const setup = () => {
  const sent: Array<IndicatorRequest> = [];
  const indicator = makeIndicator({ send: (request) => sent.push(request), now: () => Date.now() });
  const probes = () => sent.filter((request) => request.op === "probe");
  const lastProbe = () => probes().at(-1)!;
  const answer = (probe = lastProbe(), rect = RECT) =>
    indicator.receive({ op: "painted", id: probe.id, n: probe.n, rect });
  const end = (reason: "stop" | "unavailable", id = sent[0]!.id) =>
    indicator.receive({ op: "ended", id, reason });
  const closes = () => sent.filter((request) => request.op === "close").length;
  return { indicator, sent, probes, lastProbe, answer, end, closes };
};

const shown = async (t: ReturnType<typeof setup>): Promise<DrivingIndicator> => {
  const handle = t.indicator.show({ label: "Claude · Book a flight", detail: null });
  t.answer();
  return handle;
};

const reasonOf = (handle: DrivingIndicator) => (handle.signal.reason as Error | undefined)?.message;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("makeIndicator", () => {
  it("asks main for the window, then probes it at once and every 750 ms", async () => {
    const t = setup();
    void t.indicator.show({ label: "Claude", detail: "wait 500 ms" });
    expect(t.sent.slice(0, 2)).toEqual([
      { op: "show", id: 1, label: "Claude", detail: "wait 500 ms" },
      { op: "probe", id: 1, n: 1 },
    ]);
    await vi.advanceTimersByTimeAsync(749);
    expect(t.probes()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.probes()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(t.probes().map((probe) => probe.n)).toEqual([1, 2, 3, 4]);
  });

  it("resolves on the first answer, with the window's rectangle", async () => {
    const t = setup();
    const handle = await shown(t);
    expect(handle.rect).toEqual(RECT);
    expect(handle.live()).toBe(true);
    expect(handle.signal.aborted).toBe(false);
  });

  it("counts a proof for 3 s from when its probe was sent, not from its answer", async () => {
    const t = setup();
    const showing = t.indicator.show({ label: "Claude", detail: null });
    const probe = t.lastProbe();
    await vi.advanceTimersByTimeAsync(700);
    t.answer(probe);
    const handle = await showing;
    await vi.advanceTimersByTimeAsync(2_300);
    expect(handle.live()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(handle.live()).toBe(false);
  });

  it("aborts as unavailable within 100 ms of the proof expiring, and closes the window", async () => {
    const t = setup();
    const handle = await shown(t);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(handle.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(reasonOf(handle)).toBe("unavailable");
    expect(t.closes()).toBe(1);
  });

  it("stays live while each probe is answered", async () => {
    const t = setup();
    const handle = await shown(t);
    setInterval(() => t.answer(), 750);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(handle.live()).toBe(true);
    expect(handle.signal.aborted).toBe(false);
  });

  it("ignores an answer to a probe a newer one replaced", async () => {
    const t = setup();
    const handle = await shown(t);
    await vi.advanceTimersByTimeAsync(750);
    const old = t.lastProbe();
    await vi.advanceTimersByTimeAsync(750);
    t.answer(old);
    await vi.advanceTimersByTimeAsync(1_501);
    expect(handle.live()).toBe(false);
  });

  it("ignores a repeated answer", async () => {
    const t = setup();
    const showing = t.indicator.show({ label: "Claude", detail: null });
    const first = t.lastProbe();
    t.answer(first);
    const handle = await showing;
    await vi.advanceTimersByTimeAsync(2_900);
    t.answer(first);
    await vi.advanceTimersByTimeAsync(101);
    expect(handle.live()).toBe(false);
  });

  it("ignores an answer that comes after its proof would have expired", async () => {
    const t = setup();
    const showing = t.indicator.show({ label: "Claude", detail: null });
    const late = { ...t.lastProbe() };
    vi.setSystemTime(Date.now() + 3_001);
    t.answer(late);
    const outcome = expect(showing).rejects.toThrow("unavailable");
    await vi.advanceTimersByTimeAsync(100);
    await outcome;
  });

  it("rejects show after 3 s without an answer, and closes the window", async () => {
    const t = setup();
    const showing = t.indicator.show({ label: "Claude", detail: null });
    const outcome = expect(showing).rejects.toThrow("unavailable");
    await vi.advanceTimersByTimeAsync(3_000);
    await outcome;
    expect(t.closes()).toBe(1);
  });

  it("rejects a second show while a handle is open", async () => {
    const t = setup();
    await shown(t);
    await expect(t.indicator.show({ label: "Codex", detail: null })).rejects.toThrow(
      "already shown",
    );
  });

  it("aborts with stop, and keeps the pill until the plugin closes it", async () => {
    const t = setup();
    const handle = await shown(t);
    t.end("stop");
    expect(reasonOf(handle)).toBe("stop");
    expect(handle.live()).toBe(false);
    expect(t.closes()).toBe(0);
    const probes = t.probes().length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.probes()).toHaveLength(probes);
    await expect(t.indicator.show({ label: "Claude", detail: null })).rejects.toThrow(
      "already shown",
    );
    handle.close();
    expect(t.closes()).toBe(1);
    void t.indicator.show({ label: "Claude", detail: null });
    expect(t.sent.at(-2)).toMatchObject({ op: "show", id: 2 });
  });

  it("rejects show when the user stops it before its first proof", async () => {
    const t = setup();
    const showing = t.indicator.show({ label: "Claude", detail: null });
    t.end("stop");
    await expect(showing).rejects.toThrow("stop");
  });

  it("closes itself when main loses the window, so a new show can start", async () => {
    const t = setup();
    const handle = await shown(t);
    t.end("unavailable");
    expect(reasonOf(handle)).toBe("unavailable");
    expect(handle.live()).toBe(false);
    void t.indicator.show({ label: "Claude", detail: null });
    expect(t.sent.at(-2)).toMatchObject({ op: "show", id: 2 });
  });

  it("aborts when the window moved", async () => {
    const t = setup();
    const handle = await shown(t);
    await vi.advanceTimersByTimeAsync(750);
    t.answer(t.lastProbe(), { ...RECT, x: RECT.x + 1 });
    expect(reasonOf(handle)).toBe("unavailable");
    expect(handle.rect).toEqual(RECT);
  });

  it("never aborts on close, even when main's news comes after", async () => {
    const t = setup();
    const handle = await shown(t);
    handle.close();
    handle.close();
    expect(handle.live()).toBe(false);
    expect(t.closes()).toBe(1);
    t.end("stop", 1);
    t.end("unavailable", 1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(handle.signal.aborted).toBe(false);
  });

  it("ignores replies meant for an earlier handle", async () => {
    const t = setup();
    const first = await shown(t);
    first.close();
    const second = t.indicator.show({ label: "Claude", detail: null });
    t.end("stop", 1);
    t.answer();
    const handle = await second;
    expect(handle.signal.aborted).toBe(false);
    expect(handle.live()).toBe(true);
  });

  it("sends detail changes without renewing presence", async () => {
    const t = setup();
    const handle = await shown(t);
    await vi.advanceTimersByTimeAsync(2_000);
    handle.setDetail("click Search");
    expect(t.sent.at(-1)).toEqual({ op: "detail", id: 1, detail: "click Search" });
    await vi.advanceTimersByTimeAsync(1_001);
    expect(handle.live()).toBe(false);
  });

  it("caps the label and detail at 160 characters", () => {
    const t = setup();
    void t.indicator.show({ label: "a".repeat(200), detail: "b".repeat(160) });
    const show = t.sent[0];
    expect(show).toMatchObject({ op: "show", detail: "b".repeat(160) });
    expect(show?.op === "show" && show.label).toBe(`${"a".repeat(159)}…`);
  });
});
