# t3mode

Plugins for the T3 Code desktop app on Windows, in the style of Vencord. T3 Code's own code isn't modified: a small shim loads t3mode at startup, then starts the real app.

**Status:** milestone 3, plus standalone plugins. The plugin runtime, its settings pages and update handling are done. No plugins ship with the repo. Each plugin is a project of its own, published as a GitHub release and installed from its link.

In T3 Code's settings, the "T3 Mode" group has a T3 Mode page and a Plugins page. Ctrl+Alt+M opens the Plugins page from anywhere; change it in Settings → Keybindings, under "T3 Mode Plugins". See [docs/architecture.md](docs/architecture.md).

## Use

```sh
pnpm install
pnpm build
pnpm t3mode install     # close T3 Code first, or add --wait
pnpm t3mode status
```

t3mode installs T3 Code's updates itself, because T3 Code's own updater would remove it. It checks the same feed, verifies each installer's SHA-512 and signature, and installs it when you quit T3 Code, then puts itself back. Settings → T3 Mode shows the status and has "Restart now". To hand updates back to T3 Code, turn off "Install updates through T3 Mode"; then run `pnpm t3mode repair` after each update.

If something breaks, `pnpm t3mode safe` skips t3mode for the next launch, and `pnpm t3mode uninstall` restores the original. Logs are in `%APPDATA%\t3mode\logs`.

## Plugins

In Settings → Plugins, paste a plugin's GitHub link, or `owner/repo`, under "Install from GitHub". T3 Mode shows the plugin's name, author, version and repo, and installs nothing until you confirm. "Check for updates" looks for newer releases, and nothing updates without a click. The same from a terminal, with T3 Code open or closed:

```sh
pnpm t3mode plugin add owner/repo   # asks first; --yes skips the question
pnpm t3mode plugin list
pnpm t3mode plugin update           # every plugin with a newer release, or pass an id
pnpm t3mode plugin remove <id>
```

A plugin runs with the same access as T3 Code's own page, so install only plugins whose authors you trust. Safe mode (`pnpm t3mode safe`) starts T3 Code once without any.

To write a plugin, start from [templates/plugin](templates/plugin). While you work on it, `pnpm t3mode plugin link <folder>/dist` loads your build from where it is; reload T3 Code (Ctrl+R) after each build.

## Develop

```sh
pnpm t3mode sandbox     # private copy of T3 Code in .sandbox/, DevTools on port 9333
pnpm build && pnpm t3mode --install-dir .sandbox/app --home .sandbox/home deploy
pnpm typecheck && pnpm lint && pnpm test
```

The sandbox has its own profile and `T3CODE_HOME`, so it never touches the T3 Code you use.
