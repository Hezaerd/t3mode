---
name: verify-asar-swap
description: "Check a change to t3mode's app.asar swap against its TLA+ model. The model kills or fails every file step of install, repair, uninstall and the update helper's repair, and checks that T3 Code still starts. Use this before you finish any change to packages/cli/src/Install.ts (applyShim, removeShim), packages/cli/src/Asar.ts (inspect, readRootFile), packages/shim/src/index.ts (bootOriginal), the Resources names in packages/shared/src/Layout.ts, packages/cli/src/repair.ts, or the installer and repair steps of packages/main/assets/update-helper.ps1."
---

# Verify the app.asar swap

## What is verified

**Rule.** At every step where `install`, `repair`, `uninstall` or the update helper's `repair.cjs` can stop, T3 Code still starts, and `pnpm t3mode repair` can still fix the install.

**Harm.** When this breaks, T3 Code doesn't start after a command or an update is cut short. The CLI commands that should fix it refuse to run, so the user must rename files by hand or reinstall T3 Code. The update helper runs `repair.cjs` after every nightly, about every 6 hours, right after T3 Code quits, so a Windows shutdown can cut it short.

The model is `verification/asar-swap/AsarSwap.tla`. It covers one T3 Code update (v1 to v2) and at most one fault per run. A fault is a kill, where no handler runs (Ctrl+C, a Windows shutdown, a power cut), or a failed call, where the code's error handling runs (a locked file, a full disk). The fault can hit any step. TLC checks these rules in every reachable state:

| Rule              | Plain meaning                                                                   | Expected now               |
| ----------------- | ------------------------------------------------------------------------------- | -------------------------- |
| `Boots`           | T3 Code starts, as the installed version                                        | violated (findings F1, F2) |
| `Recoverable`     | `repair` and `uninstall` get past their refusals                                | violated (findings F1, F2) |
| `KeepsOriginal`   | The installed version's original archive is always in `app.asar` or `_app.asar` | holds                      |
| `OnlyKnownBreaks` | `Boots` and `Recoverable` hold everywhere except at F1 and F2                   | holds                      |

`OnlyKnownBreaks` gives the regression signal. A change that opens a new way to leave T3 Code unable to start turns it red, even while F1 and F2 are still open.

## Coverage and sync

Sync commit: **b59ef0f**. At that commit, the model was confirmed to describe this code:

| File                                     | What the model uses                                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/Install.ts`            | `applyShim` and `removeShim`: every `fs.*` and `asar.*` call, its order, its branches, and the rollback in the catch on the last rename |
| `packages/cli/src/Asar.ts`               | `inspect` and `readRootFile`: what counts as the original, the shim, or unreadable (`Kind`, the refusals, `Recoverable`)                |
| `packages/shim/src/index.ts`             | `bootOriginal`: what has to be on disk for the shim to start T3 Code (`BootedVersion` in the model)                                     |
| `packages/shared/src/Layout.ts`          | `Resources`: `app.asar`, `_app.asar`, `app.asar.unpacked`, `_app.asar.unpacked`                                                         |
| `packages/cli/src/repair.ts`             | It runs `applyShim` and nothing else (`RepairStarts`)                                                                                   |
| `packages/main/assets/update-helper.ps1` | It runs the installer, then `repair.cjs`, under the `Local\t3mode-update-helper` mutex (`InstallerUpdates`, then `RepairStarts`)        |
| `packages/cli/src/bin.ts`                | `install`, `repair` and `uninstall` call `Processes.ensureClosed` before they swap files, so T3 Code isn't running during a swap        |

To see whether a change touches the verified code, run:

```sh
git diff --stat b59ef0f -- packages/cli/src/Install.ts packages/cli/src/Asar.ts packages/shim/src/index.ts packages/shared/src/Layout.ts packages/cli/src/repair.ts packages/main/assets/update-helper.ps1 packages/cli/src/bin.ts
```

Also check the working tree with `git status`. If nothing in these files changed, the check isn't needed.

`check.ts` also checks the sync on its own. It reads `applyShim` and `removeShim` and compares their ordered `fs.*` and `asar.*` calls with `verification/asar-swap/steps.json`. It also hashes the declarations listed under `fingerprinted` in that file, and checks that `All.cfg` checks the same rules as the script. When any of these differs, it prints **MODEL OUT OF STEP** and exits 1.

## Run

```sh
pnpm verify:asar-swap                   # sync check, then the four rules (about 10 s)
pnpm verify:asar-swap -- --self-test    # also checks that each mutant in mutants.json is caught (about 20 s)
```

It needs Java 11 or later. It looks for `JAVA`, then `JAVA_HOME`, then `java` on PATH. If none is found, it says so and exits 2. The first run downloads TLC 1.7.4 into `node_modules/.cache/tla2tools/` and checks its SHA-256. To use a local copy instead, set `TLA2TOOLS` to a `tla2tools.jar` 1.7.4. TLC writes its state files to the OS temp folder and deletes them afterwards.

Exit 0 means every rule ended as the "Expected now" column says, and the model is in sync. Every result tagged `UNEXPECTED` makes it exit 1.

Each violated rule prints its shortest path as numbered steps. Each step gives the code location and what is in `app.asar`, `_app.asar` and `_app.asar.unpacked` after it. If the path ends while a command is still running, that is the state a kill at that point leaves.

Then read every result with the hstack **statechart** skill (`/hstack:statechart`). Run it on `verification/asar-swap/AsarSwap.tla`, with the config `All.cfg` and the view module `view.ts`, and send its output to a folder outside the repo. For each broken rule, it gives the shortest path in plain words. When the rules hold, it draws how the resources folder moves between states. Show the user that chart, or the path, rather than raw TLC output.

## When the check reports something

1. **MODEL OUT OF STEP.** The code changed in a way the model may not describe. Read the changed function next to `AsarSwap.tla`. Each action has a comment that names its call, and `steps.json` maps each call to an action. Then do one of these:
   - If the model still describes the code, for example after a rename or a new log line, update `steps.json`: the call text, and `fingerprint` set to the value that `node verification/asar-swap/check.ts --fingerprint` prints.
   - If the behavior changed, change the model first (see "Update the model"), then update `steps.json`.

   Never update `steps.json` alone to make the message go away.

2. **A rule that should hold is violated, or `OnlyKnownBreaks` is red.** Read the path. Then decide whether it is a real bug or a modeling error. Replay the path on the real code, one step for each step of the path:
   - Copy `verification/asar-swap/replay.scratch.ts` to `packages/cli/src/AsarSwapReplay.scratch.test.ts`. It builds a fake install, and its `FileSystem` layer fails one chosen call (`fault.current`) with `PlatformError.systemError({ _tag: "Busy", ... })`. That failure is the "a file call fails" step. For a kill, stop calling the code after the step before it.
   - Add a test for the path. Run `applyShim` or `removeShim`, then check which of `app.asar` and `_app.asar` exist, and whether `repair` or `uninstall` refuses.
   - Run `pnpm vp test run packages/cli/src/AsarSwapReplay.scratch.test.ts --silent=false`.

   If the real code ends in the same files, it is a real bug. Report it to the user with the path in these words, and don't change product code unless asked. If the real code does not, the model is wrong: fix the model, not the rule. Delete the copy before you finish, because `pnpm test` runs every test under `packages/*/src`. If you added a useful test, copy it back into `replay.scratch.ts`.

3. **A rule that is expected to be violated now holds.** A finding was fixed. Confirm it with the replay, then set that rule to `"holds"` in `steps.json` `expected`. Remove the fixed steps from `KnownBreaks` in `AsarSwap.tla` and the finding from this skill.
4. **TLC error.** This is a syntax or type error in the model, such as comparing a string with a number. Fix the model.

Never weaken a rule, add to `KnownBreaks`, or flip `expected` from "holds" to "violated" in order to pass. A new break is a finding for the user. Add it to `KnownBreaks` only after the user has seen it and decided to leave it open.

## Update the model when a change is intended

- One action is one `fs.*` or `asar.*` call that changes files. The calls that only read files are grouped into the `*Starts` action. A recursive copy or remove is in `RecursiveSteps`, because stopping it midway leaves a partial folder. A rename or a single-file remove is atomic.
- A new call that changes files gets its own action, its own `pc` label, a line in `steps.json` `calls`, an entry in `pcs` and `actions`, and its place in `Next`.
- A new error handler changes `StepFails`, which picks the next step after a failed call. A kill never runs a handler.
- When a change replaces a step in `KnownBreaks`, update that set in the same change.
- Add a mutant to `mutants.json` for each new protection. A mutant is a text edit to `AsarSwap.tla` that mirrors removing that protection from the code, and the rule it must break. Run `--self-test` and check that every mutant is caught.

After the model describes the code at your commit, and `pnpm verify:asar-swap -- --self-test` matches `expected`, set the sync commit in this file to that commit. Move it only after that confirmation.

## Findings (open at b59ef0f)

- **F1. An install or repair cut short leaves T3 Code unable to start.** `applyShim` renames `app.asar` to `_app.asar` (`Install.ts:89`). It then copies `app.asar.unpacked` (`Install.ts:91`), and only after the copy does it rename the new shim into `app.asar` (`Install.ts:93`). Until that last rename, there is no `app.asar`.
  - If the copy fails, the error propagates without a rollback. The catch covers only the last rename.
  - The same happens when the process is killed during the copy, or just before the last rename.
  - Afterwards, `repair` and `uninstall` both fail with "Could not read …\resources\app.asar." This was replayed through the real `applyShim` on a fake install, with a failing `fs.copy` (`replay.scratch.ts`).
  - It runs on every update, because the update helper's `repair.cjs` takes the same path.
- **F2. An uninstall cut short leaves T3 Code unable to start.** `removeShim` deletes `app.asar` (`Install.ts:142`) before it renames `_app.asar` to `app.asar` (`Install.ts:143`). If that rename fails, or the process is killed between the two calls, there is no `app.asar`. A second `uninstall` and `repair` then fail with "Could not read …app.asar." This was replayed the same way, with a failing rename.

In both cases `_app.asar` still holds the original, so `KeepsOriginal` holds. Renaming `_app.asar` back to `app.asar` by hand makes T3 Code start again.

## Not covered

- Two writers at once. For example, `pnpm t3mode install --wait` and the update helper can both start when T3 Code quits. The helper's mutex doesn't stop the CLI, and the CLI takes no lock. The model allows one writer at a time.
- The installer itself. It is assumed atomic, and it may keep or delete `_app.asar` and `_app.asar.unpacked`.
- Foreign shims, and archives that exist but can't be read.
- The stray `app.asar.t3mode-next`, which nothing starts from.
- NTFS rename atomicity, and the assumption that the original loads native modules from `_app.asar.unpacked`.
- More than one update, or more than one fault per run. To widen the bound, change `V` in `AsarSwap.tla` or `MaxFaults` in the `.cfg` files. These wider bounds were each run once at b59ef0f:
  - Three versions, one fault: every result as expected (792 states).
  - Two faults, with two or three versions: `KeepsOriginal` holds (1,025 and 1,800 states). `OnlyKnownBreaks` turns red, on this path only: the last rename fails, then the command is killed during the rollback (`lastStop = <<"a_rollback", "killed">>`). That path is inside F1's window, so it is not a new bug. It is outside `KnownBreaks` only because the default bound is one fault.
