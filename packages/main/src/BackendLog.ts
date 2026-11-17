// A plugin backend's log, `<home>/logs/plugins/<id>.log`. Writes are synchronous appends to one
// open file, and the writer counts the bytes it writes: when the next line would pass the limit,
// it moves the file to `<id>.old.log` and starts a new one, so a backend that runs for days or
// prints in a loop keeps at most two files of `maxBytes` each.
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off - plain Node code called from process events, outside Effect
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

export const MAX_BACKEND_LOG_BYTES = 2 * 1024 * 1024;

export interface BackendLogWriter {
  /** Appends one line with a timestamp. Never throws; a line that can't be written is dropped. */
  readonly write: (line: string) => void;
  readonly close: () => void;
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
  maxBytes: number = MAX_BACKEND_LOG_BYTES,
): BackendLogWriter => {
  const file = NodePath.join(dir, `${id}.log`);
  const old = NodePath.join(dir, `${id}.old.log`);
  try {
    NodeFs.mkdirSync(dir, { recursive: true });
  } catch {
    // tryOpen reports it by returning nothing.
  }
  let size = 0;
  try {
    size = NodeFs.statSync(file).size;
  } catch {
    // No log yet.
  }
  let fd = tryOpen(file, "a");

  const rotate = () => {
    if (fd !== undefined) NodeFs.closeSync(fd);
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
    write: (line) => {
      if (fd === undefined) return;
      const text = `${new Date().toISOString()} ${line}\n`;
      const bytes = Buffer.byteLength(text);
      try {
        if (size > 0 && size + bytes > maxBytes) rotate();
        if (fd === undefined) return;
        NodeFs.writeSync(fd, text);
        size += bytes;
      } catch {
        // A full or vanished disk: drop the line.
      }
    },
    close: () => {
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
