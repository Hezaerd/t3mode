import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/process";

export const SignatureJson = Schema.fromJsonString(
  Schema.Struct({ Status: Schema.Number, Subject: Schema.NullOr(Schema.String) }),
);

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export const signatureCommand = (file: string) =>
  ChildProcess.make("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Get-AuthenticodeSignature -LiteralPath ${quote(file)} | Select-Object @{n='Status';e={[int]$_.Status}}, @{n='Subject';e={$_.SignerCertificate.Subject}} | ConvertTo-Json -Compress`,
  ]);
