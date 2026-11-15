import { describe, expect, it } from "vite-plus/test";

import { CRASH_WINDOW_MS, FAILED_BOOT_LIMIT, decideBoot, recordCrash } from "./BootGuard.ts";

const fresh = { version: 1, failedBoots: 0 } as const;

describe("decideBoot", () => {
  it("counts a normal launch as failed until the page reports ready", () => {
    expect(decideBoot(fresh, false)).toEqual({
      mode: "normal",
      next: { version: 1, failedBoots: 1 },
    });
  });

  it("enters safe mode once after repeated launches never got ready", () => {
    const decision = decideBoot({ version: 1, failedBoots: FAILED_BOOT_LIMIT }, false);
    expect(decision).toEqual({ mode: "safe", reason: "failed-boots", next: fresh });
  });

  it("honors a requested safe mode and resets the counter", () => {
    expect(decideBoot({ version: 1, failedBoots: 1 }, true)).toEqual({
      mode: "safe",
      reason: "requested",
      next: fresh,
    });
  });
});

describe("recordCrash", () => {
  it("trips on the second crash inside the window", () => {
    const first = recordCrash([], 1_000);
    expect(first.trip).toBe(false);
    expect(recordCrash(first.times, 2_000).trip).toBe(true);
  });

  it("forgets crashes older than the window", () => {
    const later = recordCrash([1_000], 1_000 + CRASH_WINDOW_MS + 1);
    expect(later).toEqual({ times: [1_000 + CRASH_WINDOW_MS + 1], trip: false });
  });
});
