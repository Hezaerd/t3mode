import { defineConfig } from "vite-plus";

// Two self-contained CommonJS bundles, with no node_modules needed next to them:
// - repair.cjs: the update helper runs it with T3 Code's exe in Node mode, from the t3mode home.
// - t3mode.cjs: the published CLI. It ships with the other packages' bundles in dist/bundles,
//   which `install` and `deploy` copy into the t3mode home.
// `pnpm t3mode` in this repo runs src/bin.ts from source and copies the bundles from packages/*/dist.
const bundle = {
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
    alwaysBundle: (id: string) =>
      !id.startsWith("node:") && id !== "electron" && id !== "original-fs",
    onlyBundle: false,
  },
} as const;

// The files Artifacts.ts copies into the t3mode home, under the names it gives them there.
const homeBundles = [
  "../main/dist/main.cjs",
  "../main/dist/main.cjs.map",
  "../preload/dist/preload.cjs",
  "../runtime/dist/renderer.iife.js",
  "../shim/dist/index.cjs",
  "../main/assets/update-helper.ps1",
  "../main/dist/backend-host.cjs",
];

export default defineConfig({
  pack: [
    { ...bundle, entry: { repair: "src/repair.ts" } },
    {
      ...bundle,
      entry: { t3mode: "src/bin.ts" },
      clean: false,
      define: { __T3MODE_PACKAGED__: "true" },
      outputOptions: { ...bundle.outputOptions, banner: "#!/usr/bin/env node" },
      copy: homeBundles.map((from) => ({ from, to: "dist/bundles", flatten: true })),
    },
  ],
});
