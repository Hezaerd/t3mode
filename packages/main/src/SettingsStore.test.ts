import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { SettingsSchema } from "./SettingsStore.ts";

describe("SettingsSchema", () => {
  it("keeps the update setting and every plugin's settings", () => {
    const input = {
      version: 1,
      plugins: { "some-plugin": { enabled: false, options: { mode: "a" } } },
      updates: { manage: false },
    };
    expect(Schema.decodeUnknownSync(SettingsSchema)(input)).toEqual(input);
  });

  it("rejects a wrong type instead of saving it", () => {
    expect(() =>
      Schema.decodeUnknownSync(SettingsSchema)({ version: 1, plugins: {}, updates: { manage: 1 } }),
    ).toThrow();
  });
});
