import { defineConfig } from "vite-plus";

const IGNORED = ["dist", "node_modules", "pnpm-lock.yaml", "*.tsbuildinfo", ".sandbox"];

export default defineConfig({
  fmt: {
    ignorePatterns: IGNORED,
    sortPackageJson: {},
  },
  lint: {
    ignorePatterns: IGNORED,
    plugins: ["eslint", "oxc", "unicorn", "typescript"],
    categories: { correctness: "warn", suspicious: "warn", perf: "warn" },
    rules: {
      "oxc/no-accumulating-spread": "error",
      "unicorn/prefer-add-event-listener": "off",
      // Effect errors and data types are discriminated by `_tag`.
      "eslint/no-underscore-dangle": "off",
    },
    overrides: [
      {
        // Page and preload code: Effect would add about 100 kB to the page script, and the
        // sandboxed preload has no Node.
        files: [
          "packages/runtime/src/**/*.ts",
          "packages/preload/src/**/*.ts",
          "packages/shared/src/{Ipc,Plugins,Settings,Shortcut,T3Hooks,Updates,Version}.ts",
        ],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              patterns: [
                { group: ["effect", "effect/*", "@effect/*", "node:*"], allowTypeImports: true },
              ],
            },
          ],
        },
      },
    ],
  },
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts"],
    retry: 0,
  },
});
