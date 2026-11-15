// Starting update-helper.ps1 so that it outlives T3 Code. Node's `detached` option starts a
// process without a console, and powershell.exe exits at once without one. A non-detached child
// is killed with T3 Code (Node puts it in a kill-on-close job). So an attached PowerShell starts
// the helper with Start-Process, which gives it its own hidden console outside that job, and
// exits. Pure functions, so the quoting is unit tested.

/** One argument in a Windows command line, quoted the way CommandLineToArgvW reads it back. */
export const quoteWindowsArgument = (value: string): string => {
  if (value !== "" && !/[\s"]/.test(value)) return value;
  const escaped = value.replaceAll(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1");
  return `"${escaped}"`;
};

const quotePowerShell = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** The `-EncodedCommand` value for a PowerShell that starts `powershell.exe <args>` hidden. */
export const launcherCommand = (args: ReadonlyArray<string>): string => {
  const commandLine = args.map(quoteWindowsArgument).join(" ");
  const script = [
    "$ProgressPreference = 'SilentlyContinue'",
    `Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList ${quotePowerShell(commandLine)}`,
  ].join("; ");
  return Buffer.from(script, "utf16le").toString("base64");
};

export interface HelperArguments {
  readonly script: string;
  readonly parentPid: number;
  readonly installer: string;
  readonly installDir: string;
  readonly repairJs: string;
  readonly shimJs: string;
  readonly home: string;
  readonly log: string;
  readonly version: string;
  readonly relaunch: boolean;
  readonly relaunchArgs: ReadonlyArray<string>;
  readonly keepUpdaterEnv: boolean;
}

/** powershell.exe arguments that run update-helper.ps1 (see its `param` block). */
export const helperArguments = (options: HelperArguments): ReadonlyArray<string> => [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-WindowStyle",
  "Hidden",
  "-File",
  options.script,
  "-ParentPid",
  String(options.parentPid),
  "-Installer",
  options.installer,
  "-InstallDir",
  options.installDir,
  "-RepairJs",
  options.repairJs,
  "-ShimJs",
  options.shimJs,
  "-HomeDir",
  options.home,
  "-Log",
  options.log,
  "-Version",
  options.version,
  "-Relaunch",
  options.relaunch ? "1" : "0",
  // Base64 JSON, so arguments with quotes or spaces survive two command lines.
  "-RelaunchArgs",
  Buffer.from(JSON.stringify(options.relaunchArgs)).toString("base64"),
  "-KeepUpdaterEnv",
  options.keepUpdaterEnv ? "1" : "0",
];
