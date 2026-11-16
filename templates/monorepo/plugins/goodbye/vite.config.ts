import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: { plugin: "src/index.ts" },
    format: "cjs",
    platform: "browser",
    outDir: "dist",
    dts: false,
    sourcemap: false,
    outExtensions: () => ({ js: ".js" }),
    deps: { alwaysBundle: () => true, onlyBundle: false },
    copy: ["manifest.json"],
  },
});
