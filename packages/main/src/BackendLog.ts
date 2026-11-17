// A plugin backend's log, `<home>/logs/plugins/<id>.log`. Lines that arrive in one turn of the
// event loop are collected and written with one call, so a backend that prints in a tight loop
// costs main one append per turn, not one per line. The writer counts the bytes it takes: when the
// next line would pass the limit, it writes what it holds, moves the file to `<id>.old.log` and
// starts a new one, so a backend that runs for days keeps at most two files of `maxBytes` each.
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off - plain Node code called from process events, outside Effect
// @effect-diagnostics globalTimers:off - the flush runs after the turn that wrote the lines
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

export const MAX_BACKEND_LOG_BYTES = 2 * 1024 * 1024;

export interface BackendLogWriter {
  /** Queues one line with a timestamp. Never throws; a line that can't be written is dropped. */
  readonly write: (line: string) => void;
  /** Writes what is queued now, for lines that must land before main may exit. */
  readonly flush: () => void;
  /** Writes what is queued and closes the file. Later lines are dropped. */
  readonly close: () => void;
}

export interface BackendLogOptions {
  readonly maxBytes?: number;
  /** Runs the flush after the current turn. Tests pass their own. */
  readonly schedule?: (flush: () => void) => void;
  /** Appends text to the open file. Tests count the calls. */
  readonly append?: (fd: number, text: string) => void;
}

const tryOpen = (file: string, flags: "a" | "w"): number | undefined => {
  try {
    return NodeFs.openSync(file, flags);
  } catch {
    return undefined;
  }
};

export const openBackendLog = (
  dir: string,
  id: string,
  options: BackendLogOptions = {},
): BackendLogWriter => {
  const maxBytes = options.maxBytes ?? MAX_BACKEND_LOG_BYTES;
  const schedule = options.schedule ?? ((flush: () => void) => setImmediate(flush));
  const append = options.append ?? ((fd: number, text: string) => NodeFs.writeSync(fd, text));
  const file = NodePath.join(dir, `${id}.log`);
  const old = NodePath.join(dir, `${id}.old.log`);
  try {
    NodeFs.mkdirSync(dir, { recursive: true });
  } catch {
    // tryOpen reports it by returning nothing.
  }
  /** The file's size once everything queued is written. */
  let size = 0;
  try {
    size = NodeFs.statSync(file).size;
  } catch {
    // No log yet.
  }
  let fd = tryOpen(file, "a");
  let queued: Array<string> = [];
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    if (queued.length === 0) return;
    const text = queued.join("");
    queued = [];
    if (fd === undefined) return;
    try {
      append(fd, text);
    } catch {
      // A full or vanished disk: drop the lines.
    }
  };

  const rotate = () => {
    flush();
    if (fd !== undefined) {
      try {
        NodeFs.closeSync(fd);
      } catch {
        // Already gone.
      }
    }
    let flags: "a" | "w" = "a";
    try {
      NodeFs.renameSync(file, old);
    } catch {
      // Something holds the old log: start this one over instead, so the size stays bounded.
      flags = "w";
    }
    fd = tryOpen(file, flags);
    size = 0;
  };

  return {
    flush,
    write: (line) => {
      if (fd === undefined) return;
      const text = `${new Date().toISOString()} ${line}\n`;
      const bytes = Buffer.byteLength(text);
      if (size > 0 && size + bytes > maxBytes) rotate();
      queued.push(text);
      size += bytes;
      if (!scheduled) {
        scheduled = true;
        schedule(flush);
      }
    },
    close: () => {
      flush();
      if (fd === undefined) return;
      try {
        NodeFs.closeSync(fd);
      } catch {
        // Already gone.
      }
      fd = undefined;
    },
  };
};
