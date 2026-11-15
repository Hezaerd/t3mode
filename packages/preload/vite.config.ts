import { defineConfig } from "vite-plus";

// Sandboxed preloads can only require "electron", so everything else is bundled.
export default defineConfig({
  pack: {
    entry: ["src/preload.ts"],
    format: "cjs",
    platform: "node",
    outDir: "dist",
    dts: false,
    sourcemap: false,
    outExtensions: () => ({ js: ".cjs" }),
    deps: { neverBundle: ["electron"], alwaysBundle: (id) => id !== "electron" },
  },
});
