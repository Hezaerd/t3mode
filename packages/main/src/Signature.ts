import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/process";

export const SignatureJson = Schema.fromJsonString(
  Schema.Struct({ Status: Schema.Number, Subject: Schema.NullOr(Schema.String) }),
);

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

const withoutVariable = (name: string) =>
  Object.fromEntries(
    Object.keys(process.env)
      .filter((key) => key.toUpperCase() === name.toUpperCase())
      .map((key) => [key, undefined]),
  );

export const signatureCommand = (file: string) =>
  ChildProcess.make(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Get-AuthenticodeSignature -LiteralPath ${quote(file)} | Select-Object @{n='Status';e={[int]$_.Status}}, @{n='Subject';e={$_.SignerCertificate.Subject}} | ConvertTo-Json -Compress`,
    ],
    // When T3 Code starts from PowerShell 7, PSModulePath lists PowerShell 7's modules first, and
    // Windows PowerShell fails to load its Microsoft.PowerShell.Security from there. Without the
    // variable, Windows PowerShell uses its own module folders.
    { env: withoutVariable("PSModulePath"), extendEnv: true },
  );
