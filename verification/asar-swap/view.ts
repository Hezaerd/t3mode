// Labels for a statechart of AsarSwap.tla (the hstack statechart skill's --view module).
// Each chart state is what is in T3 Code's resources folder, as a user would see it start.
type Vars = Record<string, unknown>;

const bootsAs = (v: Vars) => {
  if (v.app === "shim") return v.orig !== "none" && v.origUnp === v.orig ? String(v.orig) : null;
  return v.app !== "none" && v.unp === v.app ? String(v.app) : null;
};

export const title = "T3 Code's app.asar swap, with one kill or failure";

export const state = (v: Vars) => {
  if (v.app === "none") return "app.asar missing: T3 Code won't start";
  const version = bootsAs(v);
  if (v.app === "shim")
    return version ? `t3mode on T3 Code ${version}` : "Shim without its original";
  if (!version) return "T3 Code won't start";
  return v.orig === "none"
    ? `T3 Code ${version}, no t3mode`
    : `T3 Code ${version}, no t3mode, old _app.asar left`;
};

export const group = (v: Vars) => (bootsAs(v) ? "starts" : "broken");
export const colors = { starts: "teal", broken: "orange" };

const labels: Record<string, string> = {
  RepairStarts: "you run install or repair",
  ApplyPacksShim: "the shim is built",
  ApplyRemovesStaleOriginal: "the old _app.asar is deleted",
  ApplyRemovesStaleUnpacked: "the old unpacked copy is deleted",
  ApplyMovesOriginalAside: "app.asar is renamed to _app.asar",
  ApplyCopiesUnpacked: "app.asar.unpacked is copied",
  ApplyPutsShimInPlace: "the shim becomes app.asar",
  ApplyPutsOriginalBack: "the original is put back",
  UninstallStarts: "you run uninstall",
  UninstallRemovesLeftoverOriginal: "the leftover _app.asar is deleted",
  UninstallRemovesLeftoverUnpacked: "the leftover unpacked copy is deleted",
  UninstallRemovesShim: "the shim is deleted",
  UninstallRestoresOriginal: "_app.asar is renamed to app.asar",
  UninstallRemovesUnpackedCopy: "the unpacked copy is deleted",
  CommandKilled: "the command is killed",
  StepFails: "a file call fails",
  InstallerUpdates: "T3 Code's installer updates it",
};

export const step = (action: string) => labels[action] ?? null;
