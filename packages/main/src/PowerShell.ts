import { ChildProcess } from "effect/process";

const withoutVariable = (name: string) =>
  Object.fromEntries(
    Object.keys(process.env)
      .filter((key) => key.toUpperCase() === name.toUpperCase())
      .map((key) => [key, undefined]),
  );

/** Windows PowerShell running one command, without a profile or prompts. */
export const windowsPowerShell = (command: string) =>
  ChildProcess.make("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    // When T3 Code starts from PowerShell 7, PSModulePath lists PowerShell 7's modules first, and
    // Windows PowerShell fails to load its own modules from there. Without the variable, Windows
    // PowerShell uses its own module folders.
    env: withoutVariable("PSModulePath"),
    extendEnv: true,
  });
