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
  },
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts"],
    retry: 0,
  },
});
