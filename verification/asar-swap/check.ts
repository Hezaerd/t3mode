// Checks the TLA+ model of the app.asar swap (AsarSwap.tla) with TLC, and checks that the
// model is still in step with packages/cli/src/Install.ts.
//   node verification/asar-swap/check.ts              sync check, then each rule
//   node verification/asar-swap/check.ts --self-test  also each mutant in mutants.json
//   node verification/asar-swap/check.ts --fingerprint  print the current fingerprint
// Needs Java 11 or later: `JAVA`, else `JAVA_HOME`, else `java` on PATH.
// TLC 1.7.4 comes from `TLA2TOOLS`, else it is downloaded once into node_modules/.cache.
// Exit code: 0 when every result matches steps.json "expected", 1 otherwise, 2 when a tool is missing.
// @effect-diagnostics nodeBuiltinImport:off
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

const here = import.meta.dirname;
const root = NodePath.resolve(here, "..", "..");
const SPEC = "AsarSwap";
const RULES = ["Boots", "Recoverable", "KeepsOriginal", "OnlyKnownBreaks"] as const;
const TLC_URL = "https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar";
const TLC_SHA256 = "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";

interface Steps {
  fingerprint: string;
  fingerprinted: ReadonlyArray<{ file: string; name: string }>;
  calls: ReadonlyArray<{
    file: string;
    name: string;
    steps: ReadonlyArray<readonly [string, string]>;
  }>;
  pcs: Readonly<Record<string, string>>;
  actions: Readonly<Record<string, string>>;
  expected: Readonly<Record<string, "holds" | "violated">>;
}
interface Mutant {
  name: string;
  mirrors: string;
  breaks: string;
  edits: ReadonlyArray<readonly [string, string]>;
}

const steps = JSON.parse(NodeFs.readFileSync(NodePath.join(here, "steps.json"), "utf8")) as Steps;

// ---- Sync with the code -------------------------------------------------------------------

/** The declaration of `name` at the top level of `file`, up to the next top-level statement. */
const declaration = (file: string, name: string) => {
  const lines = NodeFs.readFileSync(NodePath.join(root, file), "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^(export )?const ${name}\\b`).test(line));
  if (start < 0) throw new Error(`${file}: no top-level \`const ${name}\``);
  let end = start + 1;
  while (end < lines.length && !/^[^\s)}\]]/.test(lines[end] ?? "")) end++;
  return { start, lines: lines.slice(start, end) };
};

const stripComments = (text: string) =>
  text
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/\/\/.*$/gm, "")
    .replaceAll(/\s+/g, " ")
    .trim();

const fingerprint = () => {
  const hash = createHash("sha256");
  for (const { file, name } of steps.fingerprinted) {
    hash.update(`${file}#${name}\n${stripComments(declaration(file, name).lines.join("\n"))}\n`);
  }
  return hash.digest("hex").slice(0, 16);
};

/** Each `fs.x(...)` and `asar.x(...)` call in order, with its line. */
const callsIn = (file: string, name: string) => {
  const { start, lines } = declaration(file, name);
  const text = lines.join("\n");
  const found: Array<{ call: string; line: number }> = [];
  const head = /\b(fs|asar)\s*\.\s*(\w+)\s*\(/g;
  for (let match = head.exec(text); match; match = head.exec(text)) {
    let depth = 1;
    let i = head.lastIndex;
    while (i < text.length && depth > 0) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      i++;
    }
    const args = text
      .slice(head.lastIndex, i - 1)
      .replaceAll(/\s+/g, " ")
      .trim();
    const line = start + 1 + (text.slice(0, match.index).match(/\n/g)?.length ?? 0);
    found.push({ call: `${match[1]}.${match[2]}(${args})`, line });
  }
  return found;
};

/** Whitespace next to brackets and commas does not count. */
const normalize = (call: string) =>
  call.replaceAll(/\s+/g, " ").replaceAll(/\s*([(),[\]])\s*/g, "$1");

const codeLines = new Map<string, string>();
const syncProblems: Array<string> = [];
for (const { file, name, steps: expected } of steps.calls) {
  const actual = callsIn(file, name);
  const length = Math.max(actual.length, expected.length);
  for (let i = 0; i < length; i++) {
    const want = expected[i];
    const got = actual[i];
    if (want && got && normalize(want[0]) === normalize(got.call)) {
      if (!codeLines.has(want[1])) codeLines.set(want[1], `${file}:${got.line}`);
      continue;
    }
    syncProblems.push(
      `${file} ${name}, call ${i + 1}: steps.json has ${want ? `\`${want[0]}\` (${want[1]})` : "nothing"}, the code has ${got ? `\`${got.call}\` at line ${got.line}` : "nothing"}`,
    );
    break;
  }
}
// All.cfg feeds the statechart skill, so it must check the same rules as this script.
const allRules = /INVARIANTS?([\s\S]*)/
  .exec(NodeFs.readFileSync(NodePath.join(here, "All.cfg"), "utf8"))?.[1]
  ?.split(/\s+/)
  .filter((rule) => rule && rule !== "TypeOK")
  .toSorted()
  .join(" ");
if (allRules !== [...RULES].toSorted().join(" ")) {
  syncProblems.push(
    `All.cfg checks ${allRules || "nothing"}, but check.ts checks ${RULES.join(" ")}.`,
  );
}

const currentFingerprint = fingerprint();
if (process.argv.includes("--fingerprint")) {
  console.log(currentFingerprint);
  process.exit(0);
}
if (currentFingerprint !== steps.fingerprint) {
  syncProblems.push(
    `The covered code changed since the model was last confirmed (fingerprint ${steps.fingerprint || "unset"}, now ${currentFingerprint}).`,
  );
}

// ---- Tools ----------------------------------------------------------------------------------

const fail = (message: string): never => {
  console.error(message);
  process.exit(2);
};

const findJava = () => {
  const candidates = [
    process.env["JAVA"],
    process.env["JAVA_HOME"] && NodePath.join(process.env["JAVA_HOME"], "bin", "java"),
    "java",
  ].filter((value): value is string => Boolean(value));
  for (const java of candidates) {
    if (spawnSync(java, ["-version"], { encoding: "utf8" }).status === 0) return java;
  }
  return fail(
    "Java 11 or later is needed to run TLC. Install a JDK (for example `winget install EclipseAdoptium.Temurin.21.JDK`), or set JAVA to a java binary.",
  );
};

const sha256 = (file: string) =>
  createHash("sha256").update(NodeFs.readFileSync(file)).digest("hex");

const findJar = async () => {
  const given = process.env["TLA2TOOLS"];
  if (given) {
    if (!NodeFs.existsSync(given)) fail(`TLA2TOOLS is set to ${given}, which does not exist.`);
    if (sha256(given) !== TLC_SHA256)
      fail(`${given} is not tla2tools.jar 1.7.4 (SHA-256 differs).`);
    return given;
  }
  const cached = NodePath.join(root, "node_modules", ".cache", "tla2tools", "tla2tools-1.7.4.jar");
  if (NodeFs.existsSync(cached) && sha256(cached) === TLC_SHA256) return cached;
  console.log(`Downloading TLC 1.7.4 from ${TLC_URL}`);
  const response = await fetch(TLC_URL).catch((error: unknown) =>
    fail(`Could not download TLC: ${String(error)}. Set TLA2TOOLS to a local tla2tools.jar 1.7.4.`),
  );
  if (!response.ok) fail(`Could not download TLC: HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== TLC_SHA256) {
    fail("The downloaded tla2tools.jar does not match the pinned SHA-256.");
  }
  NodeFs.mkdirSync(NodePath.dirname(cached), { recursive: true });
  NodeFs.writeFileSync(cached, bytes);
  return cached;
};

// ---- TLC ------------------------------------------------------------------------------------

interface TraceState {
  action: string;
  vars: Record<string, string>;
}
type Outcome =
  | { kind: "holds"; states: number }
  | { kind: "violated"; trace: Array<TraceState> }
  | { kind: "error"; output: string };

const runTlc = (java: string, jar: string, specDir: string, rule: string): Outcome => {
  const config = NodePath.join(specDir, `${rule}.cfg`);
  const metaDir = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "t3mode-tlc-"));
  try {
    const result = spawnSync(
      java,
      [
        "-XX:+UseParallelGC",
        "-cp",
        jar,
        "tlc2.TLC",
        "-config",
        config,
        "-workers",
        "1",
        "-metadir",
        metaDir,
        NodePath.join(specDir, `${SPEC}.tla`),
      ],
      { cwd: specDir, encoding: "utf8" },
    );
    const output = `${result.stdout}${result.stderr}`;
    if (output.includes(`Invariant ${rule} is violated`)) {
      const trace: Array<TraceState> = [];
      for (const line of output.split(/\r?\n/)) {
        const head = /^State \d+: <(\w[\w ]*?)(?: line .*)?>$/.exec(line);
        if (head) trace.push({ action: head[1] ?? "", vars: {} });
        const value = /^\/\\ (\w+) = (.*)$/.exec(line);
        const last = trace.at(-1);
        if (value && last) last.vars[value[1] ?? ""] = value[2] ?? "";
      }
      return { kind: "violated", trace };
    }
    const done = /(\d+) distinct states found, 0 states left on queue/.exec(output);
    if (result.status === 0 && output.includes("No error has been found") && done) {
      return { kind: "holds", states: Number(done[1]) };
    }
    return { kind: "error", output };
  } finally {
    NodeFs.rmSync(metaDir, { recursive: true, force: true });
  }
};

const archive = (value: string | undefined) => {
  const text = (value ?? "").replaceAll('"', "");
  if (text === "none") return "missing";
  if (text === "shim") return "shim";
  if (text === "partial") return "partial copy";
  return `T3 Code ${text}`;
};

const describeStep = (state: TraceState, before: TraceState | undefined) => {
  const at = (pc: string | undefined) => {
    const action = steps.pcs[(pc ?? "").replaceAll('"', "")] ?? "";
    return `${steps.actions[action] ?? action}${codeLines.has(action) ? ` (${codeLines.get(action)})` : ""}`;
  };
  if (state.action === "Initial predicate") return "start: vanilla T3 Code v1";
  if (state.action === "CommandKilled")
    return `the command is killed before: ${at(before?.vars["pc"])}`;
  if (state.action === "StepFails") return `this call fails: ${at(before?.vars["pc"])}`;
  const where = codeLines.get(state.action);
  return `${steps.actions[state.action] ?? state.action}${where ? ` (${where})` : ""}`;
};

const printTrace = (trace: ReadonlyArray<TraceState>) => {
  trace.forEach((state, i) => {
    const files = `app.asar: ${archive(state.vars["app"])}, _app.asar: ${archive(state.vars["orig"])}, _app.asar.unpacked: ${archive(state.vars["origUnp"])}`;
    console.log(`     ${i + 1}. ${describeStep(state, trace[i - 1])}\n        -> ${files}`);
  });
  const pc = trace.at(-1)?.vars["pc"]?.replaceAll('"', "");
  if (pc && pc !== "idle") {
    console.log("     The command is still running. Killed at this point, it leaves these files.");
  }
};

// ---- Main -----------------------------------------------------------------------------------

const java = findJava();
const jar = await findJar();
let ok = true;

if (syncProblems.length > 0) {
  ok = false;
  console.log("MODEL OUT OF STEP with the code. Re-read the code against AsarSwap.tla:");
  for (const problem of syncProblems) console.log(`  - ${problem}`);
  console.log();
}

for (const rule of RULES) {
  const outcome = runTlc(java, jar, here, rule);
  const expected = steps.expected[rule];
  const matches = outcome.kind === expected;
  if (!matches) ok = false;
  const tag = matches ? (outcome.kind === "violated" ? "known finding" : "ok") : "UNEXPECTED";
  if (outcome.kind === "holds") {
    console.log(`${rule}: holds (${outcome.states} states) [${tag}]`);
  } else if (outcome.kind === "violated") {
    console.log(`${rule}: violated, shortest path [${tag}]`);
    printTrace(outcome.trace);
  } else {
    console.log(`${rule}: TLC error [UNEXPECTED]\n${outcome.output}`);
  }
}

if (process.argv.includes("--self-test")) {
  const mutants = JSON.parse(
    NodeFs.readFileSync(NodePath.join(here, "mutants.json"), "utf8"),
  ) as ReadonlyArray<Mutant>;
  const source = NodeFs.readFileSync(NodePath.join(here, `${SPEC}.tla`), "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  for (const mutant of mutants) {
    const dir = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "t3mode-mutant-"));
    try {
      let text = source;
      const missing = mutant.edits.filter(([from]) => text.split(from).length !== 2);
      if (missing.length > 0) {
        ok = false;
        console.log(`mutant ${mutant.name}: no longer applies to ${SPEC}.tla [UNEXPECTED]`);
        continue;
      }
      for (const [from, to] of mutant.edits) text = text.replace(from, to);
      NodeFs.writeFileSync(NodePath.join(dir, `${SPEC}.tla`), text);
      NodeFs.copyFileSync(
        NodePath.join(here, `${mutant.breaks}.cfg`),
        NodePath.join(dir, `${mutant.breaks}.cfg`),
      );
      const outcome = runTlc(java, jar, dir, mutant.breaks);
      const caught = outcome.kind === "violated";
      if (!caught) ok = false;
      console.log(
        `mutant ${mutant.name}: ${mutant.breaks} ${outcome.kind} [${caught ? "caught" : "NOT CAUGHT"}]`,
      );
      if (outcome.kind === "error") console.log(outcome.output);
    } finally {
      NodeFs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

console.log(
  ok ? "\nAll results match steps.json." : "\nSome results do not match steps.json (see above).",
);
process.exit(ok ? 0 : 1);
