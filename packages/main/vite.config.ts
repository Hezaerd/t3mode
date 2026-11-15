import { defineConfig } from "vite-plus";

// Loaded by the shim with require(), inside T3 Code's main process.
export default defineConfig({
  pack: {
    entry: ["src/main.ts"],
    format: "cjs",
    platform: "node",
    outDir: "dist",
    dts: false,
    sourcemap: true,
    outExtensions: () => ({ js: ".cjs" }),
    outputOptions: { codeSplitting: false },
    deps: {
      neverBundle: ["electron"],
      alwaysBundle: (id) => !id.startsWith("node:") && id !== "electron",
      onlyBundle: false,
    },
  },
});
