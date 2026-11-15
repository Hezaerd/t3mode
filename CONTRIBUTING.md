# Contributing to t3mode

Bug reports, fixes, and ideas for the plugin API are welcome. Everyone who takes part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Report a problem in the right place

- For a bug in t3mode, [open an issue](https://github.com/Hezaerd/t3mode/issues). Include the output of `pnpm t3mode status` and your T3 Code version.
- For a bug in a plugin, open an issue in that plugin's repo. Plugins don't live in this repo.
- For a bug you think is in T3 Code, run `pnpm t3mode safe` and try again. If the bug still happens without t3mode, report it to [T3 Code](https://github.com/pingdotgg/t3code).

Before you start a large change, such as a new plugin API or a change to how t3mode installs itself or T3 Code's updates, open an issue to agree on the design.

## Set up

You need the same tools as for an install: Windows, the T3 Code desktop app, Git, Node.js 24 or later, and pnpm.

```sh
git clone https://github.com/Hezaerd/t3mode.git
cd t3mode
pnpm install
pnpm build
```

`docs/architecture.md` explains how the loader, the runtime, and plugins fit together. Read it before you change one of them.

## Work in the sandbox

The sandbox is a private copy of T3 Code in `.sandbox/`, with its own profile and its own `T3CODE_HOME`. It never touches the T3 Code you use. To create it and start it with DevTools on port 9333, run:

```sh
pnpm t3mode sandbox
```

After each change, build and copy the bundles into the sandbox:

```sh
pnpm build
pnpm t3mode --install-dir .sandbox/app --home .sandbox/home deploy
```

Press Ctrl+R in the sandbox to load a change to the page code in `packages/runtime`. A change to `packages/main` or `packages/preload` needs a restart.

## Find your way around

- `packages/shim` is the small `app.asar` that loads t3mode and then starts T3 Code.
- `packages/main` runs in Electron's main process: settings, IPC, plugin files, and updates.
- `packages/preload` connects the page to main and runs the page scripts.
- `packages/runtime` runs in the page: plugins, the settings pages, and the shortcut.
- `packages/shared` holds the code that main and the CLI both use.
- `packages/cli` is `pnpm t3mode`.
- `packages/plugin-sdk` is `@t3mode/plugin-sdk` on npm.
- `templates/plugin` is the starting point for a new plugin.

## Open a pull request

1. Run the checks. CI doesn't run them on pull requests yet, so run them yourself:

   ```sh
   pnpm typecheck && pnpm lint && pnpm test && pnpm fmt:check
   ```

2. If you changed how t3mode behaves, update `docs/architecture.md` in the same pull request.
3. Write commit messages and the pull request title as [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`, for example `fix(runtime): let Retry read a plugin that couldn't load from disk again`. The scope is usually a package name.

Keep each pull request to one change. Small pull requests get reviewed sooner.

`PluginApi` in `packages/plugin-sdk` is a public contract, versioned by the `api` field in each plugin's manifest. A change that breaks existing plugins needs a new `api` version, so discuss it in an issue first.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
