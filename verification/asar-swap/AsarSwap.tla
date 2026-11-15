------------------------------ MODULE AsarSwap ------------------------------
(***************************************************************************)
(* The app.asar swap in packages/cli/src/Install.ts, and the files that    *)
(* decide whether T3 Code starts.                                          *)
(*                                                                         *)
(* applyShim runs for `install`, `repair`, `sandbox`, and the update       *)
(* helper's repair.cjs. removeShim runs for `uninstall`. Each step below   *)
(* is one fs/asar call in Install.ts (steps.json maps them). At any step   *)
(* the command can be killed (no handler runs: Ctrl+C, a Windows shutdown  *)
(* during the update helper, a power cut) or the call can fail (the code's *)
(* error handling runs: a locked file, a full disk).                       *)
(*                                                                         *)
(* Assumptions, not checked here:                                          *)
(*  - A file rename or a single-file remove is atomic. A recursive copy or *)
(*    remove of a folder is not: stopped midway, it leaves a partial copy. *)
(*  - T3 Code's NSIS installer is one atomic step. It writes a new         *)
(*    app.asar and app.asar.unpacked, and it may keep or delete            *)
(*    _app.asar and _app.asar.unpacked.                                    *)
(*  - Only one command writes the resources folder at a time.             *)
(*  - The original loads its native modules from <archive>.unpacked, so    *)
(*    the shim's original needs a complete _app.asar.unpacked.             *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANT MaxFaults

\* T3 Code versions, oldest first: the install starts at the first, and the
\* installer moves to the next.
V == <<"v1", "v2">>
Versions == {V[i] : i \in 1..Len(V)}
None == "none"
Partial == "partial"
Shim == "shim"
Clean == <<"none", "none">>

VARIABLES
    app,        \* resources/app.asar: None, Shim, or a vanilla T3 Code version
    unp,        \* resources/app.asar.unpacked: a version. Only the installer writes it
    orig,       \* resources/_app.asar: None or a vanilla version
    origUnp,    \* resources/_app.asar.unpacked: None, Partial, or a version
    installed,  \* index in V of the version the last installer run put in place (the exe's)
    pc,         \* the running command's next step, or "idle"
    current,    \* inspect(app.asar) at the start: "original" or "t3mode"
    hadOrig,    \* applyShim: exists(_app.asar) at the start
    faults,     \* kills and failures so far
    lastStop    \* <<step, "killed" | "failed">> of the last fault, Clean after a clean finish

vars == <<app, unp, orig, origUnp, installed, pc, current, hadOrig, faults, lastStop>>
files == <<app, unp, orig, origUnp, installed>>

Kind(a) == IF a = Shim THEN "t3mode" ELSE IF a \in Versions THEN "original" ELSE None

TypeOK ==
    /\ app \in Versions \cup {None, Shim}
    /\ unp \in Versions
    /\ orig \in Versions \cup {None}
    /\ origUnp \in Versions \cup {None, Partial}
    /\ installed \in 1..Len(V)
    /\ faults \in 0..MaxFaults

Init ==
    /\ app = V[1] /\ unp = V[1] /\ orig = None /\ origUnp = None /\ installed = 1
    /\ pc = "idle" /\ current = None /\ hadOrig = FALSE
    /\ faults = 0 /\ lastStop = Clean

Finish == pc' = "idle" /\ current' = None /\ hadOrig' = FALSE /\ lastStop' = Clean

-----------------------------------------------------------------------------
(* applyShim: install, repair, and the update helper's repair.cjs          *)

\* asar.inspect(app.asar) fails on a missing archive; a shim without _app.asar is refused.
RepairRefuses ==
    /\ pc = "idle"
    /\ \/ Kind(app) = None
       \/ app = Shim /\ orig = None
    /\ UNCHANGED vars

\* asar.inspect(app.asar), fs.exists(_app.asar), asar.readRootFile(package.json)
RepairStarts ==
    /\ pc = "idle"
    /\ Kind(app) # None
    /\ ~(app = Shim /\ orig = None)
    /\ pc' = "a_pack"
    /\ current' = Kind(app)
    /\ hadOrig' = (orig # None)
    /\ UNCHANGED <<files, faults, lastStop>>

\* asar.pack(dir, nextShim): writes app.asar.t3mode-next, which nothing boots from.
ApplyPacksShim ==
    /\ pc = "a_pack"
    /\ pc' = IF current = "original"
             THEN IF hadOrig THEN "a_removeOrig" ELSE "a_removeOrigUnp"
             ELSE "a_renameShim"
    /\ UNCHANGED <<files, current, hadOrig, faults, lastStop>>

\* fs.remove(_app.asar)
ApplyRemovesStaleOriginal ==
    /\ pc = "a_removeOrig"
    /\ orig' = None
    /\ pc' = "a_removeOrigUnp"
    /\ UNCHANGED <<app, unp, origUnp, installed, current, hadOrig, faults, lastStop>>

\* fs.remove(_app.asar.unpacked, recursive)
ApplyRemovesStaleUnpacked ==
    /\ pc = "a_removeOrigUnp"
    /\ origUnp' = None
    /\ pc' = "a_renameToOrig"
    /\ UNCHANGED <<app, unp, orig, installed, current, hadOrig, faults, lastStop>>

\* fs.rename(app.asar, _app.asar)
ApplyMovesOriginalAside ==
    /\ pc = "a_renameToOrig"
    /\ orig' = app
    /\ app' = None
    /\ pc' = "a_copy"
    /\ UNCHANGED <<unp, origUnp, installed, current, hadOrig, faults, lastStop>>

\* fs.exists(app.asar.unpacked), fs.copy(app.asar.unpacked, _app.asar.unpacked)
ApplyCopiesUnpacked ==
    /\ pc = "a_copy"
    /\ origUnp' = unp
    /\ pc' = "a_renameShim"
    /\ UNCHANGED <<app, unp, orig, installed, current, hadOrig, faults, lastStop>>

\* fs.rename(app.asar.t3mode-next, app.asar)
ApplyPutsShimInPlace ==
    /\ pc = "a_renameShim"
    /\ app' = Shim
    /\ Finish
    /\ UNCHANGED <<unp, orig, origUnp, installed, faults>>

\* The catch on the last rename: fs.rename(_app.asar, app.asar), then the error.
ApplyPutsOriginalBack ==
    /\ pc = "a_rollback"
    /\ app' = orig
    /\ orig' = None
    /\ pc' = "idle" /\ current' = None /\ hadOrig' = FALSE
    /\ UNCHANGED <<unp, origUnp, installed, faults, lastStop>>

-----------------------------------------------------------------------------
(* removeShim: uninstall                                                    *)

UninstallRefuses ==
    /\ pc = "idle"
    /\ \/ Kind(app) = None
       \/ app = Shim /\ orig = None
    /\ UNCHANGED vars

\* asar.inspect(app.asar), then fs.exists(_app.asar) on a shim
UninstallStarts ==
    /\ pc = "idle"
    /\ Kind(app) # None
    /\ ~(app = Shim /\ orig = None)
    /\ pc' = IF app = Shim THEN "r_removeShim" ELSE "r_cleanOrig"
    /\ current' = Kind(app)
    /\ UNCHANGED <<files, hadOrig, faults, lastStop>>

\* After an update replaced the shim: fs.remove(_app.asar)
UninstallRemovesLeftoverOriginal ==
    /\ pc = "r_cleanOrig"
    /\ orig' = None
    /\ pc' = "r_cleanOrigUnp"
    /\ UNCHANGED <<app, unp, origUnp, installed, current, hadOrig, faults, lastStop>>

\* fs.remove(_app.asar.unpacked, recursive)
UninstallRemovesLeftoverUnpacked ==
    /\ pc = "r_cleanOrigUnp"
    /\ origUnp' = None
    /\ Finish
    /\ UNCHANGED <<app, unp, orig, installed, faults>>

\* fs.remove(app.asar)
UninstallRemovesShim ==
    /\ pc = "r_removeShim"
    /\ app' = None
    /\ pc' = "r_renameOrig"
    /\ UNCHANGED <<unp, orig, origUnp, installed, current, hadOrig, faults, lastStop>>

\* fs.rename(_app.asar, app.asar)
UninstallRestoresOriginal ==
    /\ pc = "r_renameOrig"
    /\ app' = orig
    /\ orig' = None
    /\ pc' = "r_removeOrigUnp"
    /\ UNCHANGED <<unp, origUnp, installed, current, hadOrig, faults, lastStop>>

\* fs.remove(_app.asar.unpacked, recursive)
UninstallRemovesUnpackedCopy ==
    /\ pc = "r_removeOrigUnp"
    /\ origUnp' = None
    /\ Finish
    /\ UNCHANGED <<app, unp, orig, installed, faults>>

-----------------------------------------------------------------------------
(* Faults. The step at pc does not happen, except that a recursive copy or  *)
(* remove stopped midway leaves a partial folder.                          *)

RecursiveSteps == {"a_removeOrigUnp", "a_copy", "r_cleanOrigUnp", "r_removeOrigUnp"}

AfterFault ==
    origUnp' = IF pc \in RecursiveSteps /\ (origUnp # None \/ pc = "a_copy")
               THEN Partial ELSE origUnp

\* The process dies: no handler runs.
CommandKilled ==
    /\ pc # "idle"
    /\ faults < MaxFaults
    /\ faults' = faults + 1
    /\ lastStop' = <<pc, "killed">>
    /\ AfterFault
    /\ pc' = "idle" /\ current' = None /\ hadOrig' = FALSE
    /\ UNCHANGED <<app, unp, orig, installed>>

\* The call fails: the error propagates, through the rollback on the last rename.
StepFails ==
    /\ pc # "idle"
    /\ faults < MaxFaults
    /\ faults' = faults + 1
    /\ lastStop' = <<pc, "failed">>
    /\ AfterFault
    /\ IF pc = "a_renameShim" /\ current = "original"
       THEN pc' = "a_rollback" /\ UNCHANGED <<current, hadOrig>>
       ELSE pc' = "idle" /\ current' = None /\ hadOrig' = FALSE
    /\ UNCHANGED <<app, unp, orig, installed>>

-----------------------------------------------------------------------------
(* T3 Code's installer, run by update-helper.ps1 or by hand, while no      *)
(* t3mode command runs. The helper runs repair.cjs (RepairStarts) after it. *)

InstallerUpdates ==
    /\ pc = "idle"
    /\ installed < Len(V)
    /\ installed' = installed + 1
    /\ app' = V[installed + 1]
    /\ unp' = V[installed + 1]
    /\ \/ UNCHANGED <<orig, origUnp>>
       \/ orig' = None /\ origUnp' = None
    /\ lastStop' = Clean
    /\ UNCHANGED <<pc, current, hadOrig, faults>>

Next ==
    \/ RepairRefuses \/ RepairStarts \/ ApplyPacksShim
    \/ ApplyRemovesStaleOriginal \/ ApplyRemovesStaleUnpacked
    \/ ApplyMovesOriginalAside \/ ApplyCopiesUnpacked
    \/ ApplyPutsShimInPlace \/ ApplyPutsOriginalBack
    \/ UninstallRefuses \/ UninstallStarts
    \/ UninstallRemovesLeftoverOriginal \/ UninstallRemovesLeftoverUnpacked
    \/ UninstallRemovesShim \/ UninstallRestoresOriginal \/ UninstallRemovesUnpackedCopy
    \/ CommandKilled \/ StepFails
    \/ InstallerUpdates

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* Rules. Each holds in every state, because a kill can stop any step.     *)

\* What T3 Code starts as, per packages/shim/src/index.ts: a vanilla
\* app.asar with its unpacked folder, or the shim booting _app.asar.
BootedVersion ==
    IF app \in Versions
    THEN IF unp = app THEN app ELSE None
    ELSE IF app = Shim /\ orig \in Versions /\ origUnp = orig THEN orig ELSE None

\* T3 Code starts, as the version that is installed.
Boots == BootedVersion = V[installed]

\* `pnpm t3mode repair` and `uninstall` get past their refusals.
Recoverable == app \in Versions \/ (app = Shim /\ orig \in Versions)

\* The installed version's original archive is in app.asar or _app.asar.
KeepsOriginal == V[installed] \in {app, orig}

\* The breaks already reported (SKILL.md, Findings): app.asar is missing after
\* a command stops at one of these steps, stopped as named. "running" means
\* the command is at that step now, so a kill there would leave it so.
KnownBreaks ==
    {<<"a_copy", h>> : h \in {"running", "killed", "failed"}}
    \cup {<<"a_renameShim", h>> : h \in {"running", "killed"}}
    \cup {<<"a_rollback", "running">>}
    \cup {<<"r_renameOrig", h>> : h \in {"running", "killed", "failed"}}

Window == IF pc # "idle" THEN <<pc, "running">> ELSE lastStop

\* Boots and Recoverable hold everywhere except at the known breaks.
OnlyKnownBreaks == (Boots /\ Recoverable) \/ (app = None /\ Window \in KnownBreaks)

=============================================================================
