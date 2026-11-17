# Example t3mode plugin

A starting point for a [t3mode](https://github.com/Hezaerd/t3mode) plugin. This template publishes one plugin from its repository. t3mode also supports several plugins in one repository through a root `t3mode.json`. See the [plugin architecture](https://github.com/Hezaerd/t3mode/blob/main/docs/architecture.md#5-plugins-packagesplugin-sdk-packagessharedsrcplugints) for the registry and release layout.

## Make it yours

Edit `manifest.json`. The `id` is lowercase letters, digits and hyphens, and must never change once people install the plugin. `api` is the plugin API version the SDK targets.

For work page code can't do, such as opening a Windows named pipe or loading a native module, give the plugin a backend: name a script in the manifest's `"backend"`, default-export `defineBackend({ start })` from it, have the build write it to `dist/` too, and talk to it with `api.backend`. Users approve a backend before installing.

Write the plugin in `src/index.ts`. `definePlugin` and the API types come from `@t3mode/plugin-sdk`. Read the plugin rules in t3mode's `docs/architecture.md` first. Do the plugin's work in `start`, through the API, so turning the plugin off undoes it. t3mode runs none of a plugin's code while it is off.

## Build and try it

```sh
pnpm install
pnpm build                                 # writes dist/manifest.json and dist/plugin.js
t3mode plugin link <this folder>/dist     # once
```

After each build, reload T3 Code with Ctrl+R.

## Release

Commit `pnpm-lock.yaml`. To release, bump `version` in `manifest.json` and push to `main`. The workflow in `.github/workflows/release.yml` sees that no release has that version yet, builds the plugin, and publishes release `v<version>` with both files, plus the `backend`, `mcp` and `files` the manifest names. Anyone can then install it from the Plugins page, or with `t3mode plugin add <owner>/<repo>`.
