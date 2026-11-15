import { defineConfig } from "vite-plus";

// The CLI runs from source. Only repair.cjs is bundled: the update helper runs it with
// T3 Code's exe in Node mode, from the t3mode home, where no node_modules exist.
export default defineConfig({
  pack: {
    entry: { repair: "src/repair.ts" },
    format: "cjs",
    platform: "node",
    outDir: "dist",
    dts: false,
    // @electron/asar calls createRequire(import.meta.url).
    shims: true,
    sourcemap: false,
    outExtensions: () => ({ js: ".cjs" }),
    outputOptions: { codeSplitting: false },
    deps: {
      neverBundle: ["electron", "original-fs"],
      alwaysBundle: (id) => !id.startsWith("node:") && id !== "electron" && id !== "original-fs",
      onlyBundle: false,
    },
  },
});
