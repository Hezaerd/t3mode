import { defineConfig } from "vite-plus";

// One self-contained CommonJS file: the shim archive holds nothing else.
export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    format: "cjs",
    platform: "node",
    outDir: "dist",
    dts: false,
    sourcemap: false,
    outExtensions: () => ({ js: ".cjs" }),
    deps: {
      neverBundle: ["electron"],
      alwaysBundle: (id) => !id.startsWith("node:") && id !== "electron",
      onlyBundle: false,
    },
  },
});
