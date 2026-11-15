// The shim is T3 Code's new `app.asar` entry. Two jobs, in this order:
// 1. Try to load the t3mode loader. Any failure is logged and swallowed.
// 2. Always boot the original T3 Code from `_app.asar`.
// It has no dependencies and no Effect runtime: it must never be the reason T3 Code fails to start.
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
import * as NodeFs from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import { app } from "electron";

import {
  DISABLE_ENV,
  type HomeLayout,
  Resources,
  homeLayout,
  resolveHomeRoot,
} from "@t3mode/shared/Layout";

const originalAsar = NodePath.join(process.resourcesPath, Resources.originalAsar);

const logShimError = (layout: HomeLayout, error: unknown): void => {
  try {
    NodeFs.mkdirSync(layout.logs, { recursive: true });
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    NodeFs.appendFileSync(layout.shimLog, `${new Date().toISOString()} loader failed: ${detail}\n`);
  } catch {
    // Nowhere left to report to. Booting T3 Code matters more.
  }
};

const loadMod = (): void => {
  if (process.env[DISABLE_ENV] === "1") return;
  const layout = homeLayout(resolveHomeRoot(process.env, app.getPath("appData")));
  if (!NodeFs.existsSync(layout.mainJs)) return;
  try {
    NodeModule.createRequire(layout.mainJs)(layout.mainJs);
  } catch (error) {
    logShimError(layout, error);
  }
};

const bootOriginal = (): void => {
  const pkg = JSON.parse(
    NodeFs.readFileSync(NodePath.join(originalAsar, "package.json"), "utf8"),
  ) as { main?: string };
  const mainPath = NodePath.join(originalAsar, pkg.main ?? "index.js");
  // Not in Electron's typings, but it is what Electron itself calls at startup.
  // T3 Code resolves its bundled resources from the app path.
  (app as unknown as { setAppPath: (path: string) => void }).setAppPath(originalAsar);
  const load = NodeModule.createRequire(mainPath);
  if (load.main) load.main.filename = mainPath;
  load(mainPath);
};

loadMod();
bootOriginal();
