# t3mode

Plugins for the T3 Code desktop app on Windows, in the style of Vencord. T3 Code's own code isn't modified: a small shim loads t3mode at startup, then starts the real app.

**Status:** milestone 3. The plugin runtime, its settings pages and update handling are done. No plugins ship with the repo: your own go in `packages/runtime/src/userplugins/`, which git ignores (see the [README there](packages/runtime/src/userplugins/README.md)).

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

## Develop

```sh
pnpm t3mode sandbox     # private copy of T3 Code in .sandbox/, DevTools on port 9333
pnpm build && pnpm t3mode --install-dir .sandbox/app --home .sandbox/home deploy
pnpm typecheck && pnpm lint && pnpm test
```

The sandbox has its own profile and `T3CODE_HOME`, so it never touches the T3 Code you use.
