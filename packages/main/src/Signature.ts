import * as Schema from "effect/Schema";

import { windowsPowerShell } from "./PowerShell.ts";

export const SignatureJson = Schema.fromJsonString(
  Schema.Struct({ Status: Schema.Number, Subject: Schema.NullOr(Schema.String) }),
);

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export const signatureCommand = (file: string) =>
  windowsPowerShell(
    `Get-AuthenticodeSignature -LiteralPath ${quote(file)} | Select-Object @{n='Status';e={[int]$_.Status}}, @{n='Subject';e={$_.SignerCertificate.Subject}} | ConvertTo-Json -Compress`,
  );
