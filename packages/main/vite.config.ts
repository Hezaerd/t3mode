import { defineConfig } from "vite-plus";
import type { PackUserConfig } from "vite-plus/pack";

const node: PackUserConfig = {
  format: "cjs",
  platform: "node",
  outDir: "dist",
  dts: false,
  outExtensions: () => ({ js: ".cjs" }),
  outputOptions: { codeSplitting: false },
  deps: {
    neverBundle: ["electron"],
    alwaysBundle: (id) => !id.startsWith("node:") && id !== "electron",
    onlyBundle: false,
  },
};

export default defineConfig({
  pack: [
    // Loaded by the shim with require(), inside T3 Code's main process.
    { ...node, entry: { main: "src/main.ts" }, sourcemap: true },
    // Forked by main as each plugin backend's utility process. It requires the plugin's script.
    { ...node, entry: { "backend-host": "src/host/backendHost.ts" }, clean: false },
    // The desktop indicator window: a sandboxed preload, which can only require "electron", and
    // the page's one classic script.
    { ...node, entry: { "indicator-preload": "src/indicator/preload.ts" }, clean: false },
    {
      entry: { indicator: "src/indicator/page.ts" },
      format: "iife",
      platform: "browser",
      outDir: "dist",
      dts: false,
      clean: false,
      deps: { alwaysBundle: () => true },
    },
  ],
});
