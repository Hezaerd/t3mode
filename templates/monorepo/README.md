# A t3mode plugin monorepo

A starting point for several [t3mode](https://github.com/Hezaerd/t3mode) plugins in one GitHub repository. Copy this folder into your repository root.

## Layout

`plugins/hello` and `plugins/goodbye` each contain a manifest, a source entry point, a package file, and a Vite config. Each build writes `dist/manifest.json` and `dist/plugin.js` inside its plugin folder.

The root shares the SDK dependency and TypeScript config. `pnpm-workspace.yaml` includes every folder under `plugins`. `t3mode.json` maps each plugin id to its built folder.

## Build and try the plugins

```sh
pnpm install
pnpm build
```

Run this command once to link every plugin.

```sh
t3mode plugin link <repo root>
```

Rebuild after each source change. Reload T3 Code with Ctrl+R.

## Add a plugin

Copy `plugins/hello` to a new folder under `plugins`. Give its `package.json` a unique name. Edit its `manifest.json` and `src/index.ts`.

Add the manifest id to the root `t3mode.json`. Set its route to `plugins/<folder>/dist`. Routes use relative POSIX paths without `.` or `..` segments. Each id must match `^[a-z0-9][a-z0-9-]{0,63}$` and equal the manifest id. Keep ids stable after installation. The repository can list up to 50 plugins.

Read t3mode's `docs/architecture.md` for the plugin rules. Put plugin work in `start` and use the SDK API so disabling the plugin undoes its work.

## Release every plugin together

Commit `pnpm-lock.yaml`. Bump any plugin's manifest version and push to `main`. You can also run the release workflow manually.

The workflow builds and validates every plugin. It compares their versions with the latest release's `<id>.manifest.json` assets. A changed version or a missing plugin publishes a release. The first run publishes when the repository has no release.

Each release uses the tag `r-<short commit sha>`. A rerun skips a tag that already exists. Every release carries the root `t3mode.json` verbatim and every plugin's `<id>.manifest.json` and `<id>.plugin.js`. A plugin whose manifest names a `backend`, an `mcp` script or `files` also gets each of them as `<id>.<name>`. Unchanged plugins are included too, because t3mode downloads each plugin from the latest release.

Run the validation and asset staging locally after a build.

```sh
node scripts/stage-release.mjs
```

The script writes the assets to `.release`. Its `--release` mode also checks GitHub through `gh` and requires `GITHUB_SHA` and GitHub authentication. The workflow uses that mode to decide whether to publish.

Users install with `owner/repo` on the Plugins page and pick which plugins to install.
