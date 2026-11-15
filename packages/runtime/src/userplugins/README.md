# User plugins

Your own plugins go here. Git ignores everything in this folder except this file, so they stay on
your machine.

Each plugin is a file (`myPlugin.ts`) or a folder (`myPlugin/index.ts`) whose default export is a
plugin:

```ts
import { definePlugin } from "../types.ts";

export default definePlugin({
  id: "my-plugin",
  name: "My plugin",
  description: "What it does, in one sentence.",
  enabledByDefault: true,
  options: {},
  start(api) {
    api.css(`/* … */`);
  },
});
```

From a folder, import with `../../` instead of `../`. Then `pnpm build` and `pnpm t3mode deploy`,
and reload T3 Code. See "Plugins" in docs/architecture.md for the API and the rules.
