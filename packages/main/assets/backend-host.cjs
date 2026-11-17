// Runs one plugin's backend in its own Electron utility process (see "Backends" in
// docs/architecture.md). Main forks this file with the plugin's id, script and data folder in the
// environment. It loads the script, which default-exports defineBackend({ start }), and carries
// messages between the plugin's `api` and main over process.parentPort. Any error the plugin
// leaves uncaught ends the process, and main restarts it with backoff.
"use strict";

const port = process.parentPort;
const id = process.env.T3MODE_PLUGIN_ID ?? "";
const script = process.env.T3MODE_PLUGIN_BACKEND ?? "";
const dataDir = process.env.T3MODE_PLUGIN_DATA ?? "";

const describe = (error) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);
const fatal = (error) => {
  process.stderr.write(`[fatal] ${describe(error)}\n`, () => process.exit(1));
};
process.on("uncaughtException", fatal);
process.on("unhandledRejection", fatal);

// Messages can arrive before the plugin calls onMessage. They wait, up to a limit.
const MAX_QUEUED = 1000;
const listeners = [];
let queued = [];
const deliver = (data) => {
  for (const listener of listeners) {
    try {
      listener(data);
    } catch (error) {
      fatal(error);
    }
  }
};
port.on("message", (event) => {
  const message = event.data;
  if (!message || message._tag !== "message") return;
  if (queued === undefined) deliver(message.data);
  else if (queued.length < MAX_QUEUED) queued.push(message.data);
});

const write = (stream, level, message) => stream.write(`[${level}] ${message}\n`);
const api = Object.freeze({
  id,
  dataDir,
  send: (data) => port.postMessage({ _tag: "message", data }),
  onMessage: (listener) => {
    if (typeof listener !== "function") throw new TypeError("onMessage takes a function.");
    listeners.push(listener);
    if (queued === undefined) return;
    const waiting = queued;
    queued = undefined;
    queueMicrotask(() => {
      for (const data of waiting) deliver(data);
    });
  },
  log: (level, message) =>
    write(level === "error" || level === "warn" ? process.stderr : process.stdout, level, message),
});

let definition;
try {
  const loaded = require(script);
  definition =
    loaded && typeof loaded === "object" && "default" in loaded ? loaded.default : loaded;
} catch (error) {
  fatal(error);
}
if (definition !== undefined && (!definition || typeof definition.start !== "function")) {
  fatal(new Error(`${script} must default-export defineBackend({ start }).`));
} else if (definition) {
  Promise.resolve()
    .then(() => definition.start(api))
    .then(() => port.postMessage({ _tag: "ready" }), fatal);
}
