import { defineConfig } from "vite-plus";

// The published build. Inside the workspace, packages import src/index.ts directly.
export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    format: "esm",
    platform: "neutral",
    outDir: "dist",
    dts: { generator: "oxc" },
    sourcemap: false,
    outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  },
});
