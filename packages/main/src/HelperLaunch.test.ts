import { describe, expect, it } from "vite-plus/test";

import { helperArguments, launcherCommand, quoteWindowsArgument } from "./HelperLaunch.ts";

describe("quoteWindowsArgument", () => {
  it("leaves plain arguments alone", () => {
    expect(quoteWindowsArgument("-File")).toBe("-File");
    expect(quoteWindowsArgument(String.raw`C:\Users\me\file.ps1`)).toBe(
      String.raw`C:\Users\me\file.ps1`,
    );
  });

  it("quotes spaces, quotes and empty strings like CommandLineToArgvW expects", () => {
    expect(quoteWindowsArgument(String.raw`C:\Program Files\T3 Code`)).toBe(
      String.raw`"C:\Program Files\T3 Code"`,
    );
    expect(quoteWindowsArgument(String.raw`C:\a b\\`)).toBe(String.raw`"C:\a b\\\\"`);
    expect(quoteWindowsArgument('say "hi"')).toBe(String.raw`"say \"hi\""`);
    expect(quoteWindowsArgument("")).toBe('""');
  });
});

describe("launcherCommand", () => {
  it("encodes a Start-Process call with the quoted command line", () => {
    const script = Buffer.from(launcherCommand(["-File", "C:\\it's here\\h.ps1"]), "base64")
      .toString("utf16le")
      .split("; ")[1];
    expect(script).toBe(
      `Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList '-File "C:\\it''s here\\h.ps1"'`,
    );
  });
});

describe("helperArguments", () => {
  it("passes the relaunch arguments as base64 JSON", () => {
    const args = helperArguments({
      script: "h.ps1",
      parentPid: 42,
      installer: "setup.exe",
      installDir: "C:\\t3",
      repairJs: "repair.cjs",
      shimJs: "shim.cjs",
      home: "C:\\home",
      log: "update.log",
      version: "1.2.3",
      relaunch: true,
      relaunchArgs: ["--flag=a b"],
      keepUpdaterEnv: false,
      pluginFolders: [String.raw`D:\dev\computer use\dist`],
    });
    const at = (name: string) => args[args.indexOf(name) + 1];
    expect(at("-ParentPid")).toBe("42");
    expect(at("-Relaunch")).toBe("1");
    expect(at("-KeepUpdaterEnv")).toBe("0");
    expect(JSON.parse(Buffer.from(at("-PluginFolders") ?? "", "base64").toString())).toEqual([
      String.raw`D:\dev\computer use\dist`,
    ]);
    expect(JSON.parse(Buffer.from(at("-RelaunchArgs") ?? "", "base64").toString())).toEqual([
      "--flag=a b",
    ]);
  });
});
