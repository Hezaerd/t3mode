// Runs one plugin's backend in its own Electron utility process (see "Backends" in
// docs/architecture.md). Main forks this file with the plugin's id, script and data folder in the
// environment. It loads the script, which default-exports defineBackend({ start }), and carries
// messages between the plugin's `api` and main over process.parentPort. Any error the plugin
// leaves uncaught ends the process, and main restarts it with backoff.
import type { BackendApi, BackendDefinition, LogLevel } from "@t3mode/plugin-sdk";
import { BackendEnv, type FromBackendHost, type ToBackendHost } from "@t3mode/shared/Backends";

import { makeIndicator } from "./Indicator.ts";

const port = process.parentPort;
const id = process.env[BackendEnv.plugin] ?? "";
const script = process.env[BackendEnv.script] ?? "";
const dataDir = process.env[BackendEnv.data] ?? "";

const describe = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);
const fatal = (error: unknown) => {
  process.stderr.write(`[fatal] ${describe(error)}\n`, () => process.exit(1));
};
process.on("uncaughtException", fatal);
process.on("unhandledRejection", fatal);

const post = (message: FromBackendHost) => port.postMessage(message);

// Messages can arrive before the plugin calls onMessage. They wait, up to a limit.
const MAX_QUEUED = 1000;
const listeners: Array<(data: unknown) => void> = [];
let queued: Array<unknown> | undefined = [];
const deliver = (data: unknown) => {
  for (const listener of listeners) {
    try {
      listener(data);
    } catch (error) {
      fatal(error);
    }
  }
};
const indicator = makeIndicator({
  send: (request) => post({ _tag: "indicator", request }),
  now: () => performance.now(),
});
port.on("message", (event) => {
  const message = event.data as ToBackendHost | null;
  if (message?._tag === "indicator") indicator.receive(message.reply);
  if (message?._tag !== "message") return;
  if (queued === undefined) deliver(message.data);
  else if (queued.length < MAX_QUEUED) queued.push(message.data);
});

const write = (stream: NodeJS.WriteStream, level: LogLevel, message: string) =>
  stream.write(`[${level}] ${message}\n`);
const api: BackendApi = Object.freeze({
  id,
  dataDir,
  send: (data: unknown) => post({ _tag: "message", data }),
  onMessage: (listener: (data: unknown) => void) => {
    if (typeof listener !== "function") throw new TypeError("onMessage takes a function.");
    listeners.push(listener);
    if (queued === undefined) return;
    const waiting = queued;
    queued = undefined;
    queueMicrotask(() => {
      for (const data of waiting) deliver(data);
    });
  },
  log: (level: LogLevel, message: string) =>
    write(level === "error" || level === "warn" ? process.stderr : process.stdout, level, message),
  indicator: Object.freeze({ show: indicator.show }),
});

let definition: BackendDefinition | undefined;
try {
  const loaded = require(script) as unknown;
  definition = (
    loaded && typeof loaded === "object" && "default" in loaded ? loaded.default : loaded
  ) as BackendDefinition;
} catch (error) {
  fatal(error);
}
if (definition !== undefined && (!definition || typeof definition.start !== "function")) {
  fatal(new Error(`${script} must default-export defineBackend({ start }).`));
} else if (definition) {
  const started = definition;
  Promise.resolve()
    .then(() => started.start(api))
    .then(() => post({ _tag: "ready" }), fatal);
}
