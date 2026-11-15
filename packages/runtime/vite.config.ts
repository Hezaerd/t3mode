import { defineConfig } from "vite-plus";

// Run in the page with webFrame.executeJavaScript, so one classic script with no imports.
export default defineConfig({
  pack: {
    entry: { renderer: "src/renderer.ts" },
    format: "iife",
    platform: "browser",
    outDir: "dist",
    dts: false,
    sourcemap: false,
    outExtensions: () => ({ js: ".js" }),
    deps: { alwaysBundle: () => true },
  },
});
