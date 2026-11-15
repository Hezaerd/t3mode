// Where t3mode keeps its files, and the names of the files it puts next to T3 Code.
// The shim bundles this module, so it must stay free of runtime dependencies.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

export const HOME_ENV = "T3MODE_HOME";
export const DISABLE_ENV = "T3MODE_DISABLE";
export const SANDBOX_APPDATA_ENV = "T3MODE_SANDBOX_APPDATA";

/** File names inside T3 Code's `resources` folder. */
export const Resources = {
  shimAsar: "app.asar",
  originalAsar: "_app.asar",
  unpacked: "app.asar.unpacked",
  originalUnpacked: "_app.asar.unpacked",
} as const;

/** Marker file at the root of the shim archive. */
export const MARKER_FILE = "t3mode.json";

/** Bump when the shim's behavior changes, so `status` can tell an old shim apart. */
export const SHIM_VERSION = 1;

export interface Marker {
  readonly name: "t3mode";
  readonly shimVersion: number;
}

export const makeMarker = (): Marker => ({ name: "t3mode", shimVersion: SHIM_VERSION });

export interface HomeLayout {
  readonly root: string;
  readonly dist: string;
  readonly mainJs: string;
  readonly preloadJs: string;
  readonly rendererJs: string;
  readonly settings: string;
  readonly state: string;
  readonly logs: string;
  readonly mainLog: string;
  readonly shimLog: string;
  readonly safeMode: string;
}

export const resolveHomeRoot = (
  env: Readonly<Record<string, string | undefined>>,
  appData: string,
): string => env[HOME_ENV]?.trim() || NodePath.join(appData, "t3mode");

export const homeLayout = (root: string): HomeLayout => {
  const dist = NodePath.join(root, "dist");
  const logs = NodePath.join(root, "logs");
  return {
    root,
    dist,
    mainJs: NodePath.join(dist, "main.cjs"),
    preloadJs: NodePath.join(dist, "preload.cjs"),
    rendererJs: NodePath.join(dist, "renderer.js"),
    settings: NodePath.join(root, "settings.json"),
    state: NodePath.join(root, "state.json"),
    logs,
    mainLog: NodePath.join(logs, "main.log"),
    shimLog: NodePath.join(logs, "shim.log"),
    safeMode: NodePath.join(root, "SAFE_MODE"),
  };
};
