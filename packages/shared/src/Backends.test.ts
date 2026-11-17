import { describe, expect, it } from "vite-plus/test";

import { BACKEND_MAX_RETRY_MS, backendRetryDelay } from "./Backends.ts";

describe("backendRetryDelay", () => {
  it("doubles from one second and stops at the cap", () => {
    expect([1, 2, 3, 4, 5, 6].map(backendRetryDelay)).toEqual([
      1_000,
      2_000,
      4_000,
      8_000,
      BACKEND_MAX_RETRY_MS,
      BACKEND_MAX_RETRY_MS,
    ]);
    expect(backendRetryDelay(0)).toBe(1_000);
  });
});
