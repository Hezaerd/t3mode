// Plugins come from src/userplugins/, which git ignores: each one is a file (`name.ts`) or a
// folder (`name/index.ts`) whose default export is a `definePlugin(...)`. The bundler finds them
// at build time, so a fresh clone builds with none. Plugins meant for everyone would be imported
// here next to them.
import type { Plugin } from "../types.ts";

const userPlugins = import.meta.glob<{ readonly default: Plugin }>(
  ["../userplugins/*.ts", "../userplugins/*/index.ts", "!../userplugins/**/*.test.ts"],
  { eager: true },
);

/** Every plugin in this build, sorted by name, in the order the settings page lists them. */
export const plugins: ReadonlyArray<Plugin> = Object.values(userPlugins)
  .map((module) => module.default)
  .toSorted((a, b) => a.name.localeCompare(b.name));
