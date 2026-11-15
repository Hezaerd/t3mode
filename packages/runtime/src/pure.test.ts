import { describe, expect, it } from "vite-plus/test";

import { currentThreadKey } from "./lib/thread.ts";
import { optionValues } from "./Runtime.ts";
import type { OptionsSpec } from "./types.ts";

describe("optionValues", () => {
  const spec: OptionsSpec = {
    compact: { type: "boolean", label: "Compact", default: false },
    when: {
      type: "select",
      label: "When",
      choices: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
      default: "a",
    },
  };

  it("uses defaults when nothing is stored", () => {
    expect(optionValues(spec, undefined)).toEqual({ compact: false, when: "a" });
  });

  it("keeps valid stored values", () => {
    expect(optionValues(spec, { compact: true, when: "b" })).toEqual({ compact: true, when: "b" });
  });

  it("drops invalid or unknown stored values", () => {
    expect(optionValues(spec, { compact: "yes", when: "c", extra: 1 })).toEqual({
      compact: false,
      when: "a",
    });
  });
});

describe("currentThreadKey", () => {
  it("keys a thread by environment and thread id", () => {
    expect(currentThreadKey("#/env-1/thread%3A42")).toBe("env-1:thread:42");
  });

  it("keys drafts", () => {
    expect(currentThreadKey("#/draft/abc")).toBe("draft:abc");
  });

  it("ignores query strings", () => {
    expect(currentThreadKey("#/env/t1?panel=diff")).toBe("env:t1");
  });

  it("returns null off a thread", () => {
    for (const hash of ["", "#/", "#/settings/general", "#/usage/x", "#/env", "#/env/%E0%A4%A"]) {
      expect(currentThreadKey(hash)).toBeNull();
    }
  });
});
