# t3mode

t3mode adds plugins to the [T3 Code](https://github.com/pingdotgg/t3code) desktop app on Windows, the way Vencord does for Discord. It doesn't edit T3 Code's code. A small loader runs first at startup, and then it starts the real app.

t3mode is a community project. The T3 Code team doesn't make or support it, so report t3mode problems here, not to T3 Code.

## What you get

- A **T3 Mode** group in T3 Code's settings, with a **T3 Mode** page and a **Plugins** page. Ctrl+Alt+M opens **Plugins** from anywhere. To change the key, go to **Settings → Keybindings** and find "T3 Mode Plugins".
- Plugins installed from a GitHub link. t3mode ships no plugins of its own. Each plugin is a separate project, published as a GitHub release.
- T3 Code updates that keep t3mode installed. See [T3 Code updates](#t3-code-updates).

## Requirements

- Windows, with the T3 Code desktop app installed. t3mode looks for it in `%LOCALAPPDATA%\Programs\t3code`. If yours is somewhere else, pass `--install-dir <folder>` to each command.
- [Git](https://git-scm.com/).
- [Node.js](https://nodejs.org/) 24 or later.
- [pnpm](https://pnpm.io/installation).

## Install

1. Clone the repo and build t3mode:

   ```sh
   git clone https://github.com/Hezaerd/t3mode.git
   cd t3mode
   pnpm install
   pnpm build
   ```

2. Close T3 Code.
3. Install t3mode:

   ```sh
   pnpm t3mode install
   ```

   The command renames T3 Code's `resources\app.asar` to `_app.asar` and puts t3mode's loader in its place. `pnpm t3mode uninstall` puts the original back. To have the command wait until T3 Code closes, add `--wait`. To start T3 Code when it finishes, add `--launch`.

4. Start T3 Code. The settings now have a **T3 Mode** group.

Keep the `t3mode` folder. Every `pnpm t3mode` command runs from it. To see what is installed, run `pnpm t3mode status`.

## Install plugins

In **Settings → Plugins**, paste a plugin's GitHub link or `owner/repo` under **Install from GitHub**. t3mode shows the plugin's name, author, version, and repo. It installs nothing until you confirm. **Check for updates** finds newer releases, and a plugin updates only when you click.

The same commands work from a terminal, with T3 Code open or closed:

```sh
pnpm t3mode plugin add owner/repo   # asks first. --yes skips the question
pnpm t3mode plugin list
pnpm t3mode plugin update           # every plugin with a newer release, or pass an id
pnpm t3mode plugin remove <id>
```

A plugin runs with the same access as T3 Code's own page. Install only plugins whose authors you trust.

## T3 Code updates

T3 Code's own updater would remove t3mode, so t3mode installs T3 Code's updates itself. It reads the same release feed and checks each installer's SHA-512 hash and signature. When you quit T3 Code, it runs the installer and then puts itself back. **Settings → T3 Mode** shows the update status and has **Restart now**.

To give updates back to T3 Code, turn off **Install updates through T3 Mode**. After each T3 Code update, run `pnpm t3mode repair` to put t3mode back.

## If something breaks

- `pnpm t3mode safe` makes the next T3 Code launch skip t3mode and its plugins. The launch after that loads them again.
- `pnpm t3mode uninstall` restores the original T3 Code. Add `--purge` to also delete t3mode's data in `%APPDATA%\t3mode`.
- Logs are in `%APPDATA%\t3mode\logs`.

To report a bug, [open an issue](https://github.com/Hezaerd/t3mode/issues) with the output of `pnpm t3mode status`.

## Write a plugin

Start from [templates/plugin](templates/plugin). It uses [`@t3mode/plugin-sdk`](https://www.npmjs.com/package/@t3mode/plugin-sdk) and has a workflow that publishes releases. Read the plugin rules in [docs/architecture.md](docs/architecture.md) before you write one.

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md). Everyone who takes part follows the [code of conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE).
