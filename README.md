# t3mode

Plugins for the T3 Code desktop app on Windows, in the style of Vencord. T3 Code's own code isn't modified: a small shim loads t3mode at startup, then starts the real app.

**Status:** milestone 1. The loader and a test badge work. The real plugins come in milestone 2. See [docs/architecture.md](docs/architecture.md).

## Use

```sh
pnpm install
pnpm build
pnpm t3mode install     # close T3 Code first, or add --wait
pnpm t3mode status
```

A T3 Code update replaces the shim. Until t3mode handles updates itself (milestone 3), run `pnpm t3mode repair` after each update.

If something breaks, `pnpm t3mode safe` skips t3mode for the next launch, and `pnpm t3mode uninstall` restores the original. Logs are in `%APPDATA%\t3mode\logs`.

## Develop

```sh
pnpm t3mode sandbox     # private copy of T3 Code in .sandbox/, DevTools on port 9333
pnpm build && pnpm t3mode --install-dir .sandbox/app --home .sandbox/home deploy
pnpm typecheck && pnpm lint && pnpm test
```

The sandbox has its own profile and `T3CODE_HOME`, so it never touches the T3 Code you use.
