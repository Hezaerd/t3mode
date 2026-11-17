# t3mode

The `t3mode` command. It installs [t3mode](https://github.com/Hezaerd/t3mode), the plugin loader for the [T3 Code](https://github.com/pingdotgg/t3code) desktop app on Windows, and manages its plugins.

```sh
npx t3mode install --wait --launch
```

`--wait` waits until you close T3 Code. `--launch` starts it again when the install is done.

To keep the command, install it globally with `npm install --global t3mode`. Other commands: `t3mode status`, `t3mode plugin add <owner/repo>`, `t3mode safe`, `t3mode uninstall`. Run `t3mode --help` for the full list.

t3mode is a community project. The T3 Code team doesn't make or support it.
