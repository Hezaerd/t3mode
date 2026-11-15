// Synchronous file access for the loader. The loader runs before T3 Code's own main
// and has to finish its setup before T3 Code starts, so it cannot wait on async I/O.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export class FilesError extends Schema.TaggedError<FilesError>()("FilesError", {
  operation: Schema.String,
  path: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `t3mode could not ${this.operation} ${this.path}.`;
  }
}

export class Files extends Context.Service<
  Files,
  {
    readonly list: (path: string) => Effect.Effect<ReadonlyArray<string>, FilesError>;
    readonly readText: (path: string) => Effect.Effect<Option.Option<string>, FilesError>;
    /** Writes a temp file next to `path`, then renames it over `path`. */
    readonly writeTextAtomic: (path: string, text: string) => Effect.Effect<void, FilesError>;
    readonly append: (path: string, text: string) => Effect.Effect<void, FilesError>;
    readonly exists: (path: string) => Effect.Effect<boolean>;
    readonly remove: (path: string) => Effect.Effect<void, FilesError>;
  }
>()("@t3mode/main/Files") {}

const attempt = <A>(operation: string, path: string, run: () => A) =>
  Effect.try({ try: run, catch: (cause) => new FilesError({ operation, path, cause }) });

export const make = Files.of({
  list: Effect.fn("Files.list")((path: string) =>
    attempt("list", path, () => (NodeFs.existsSync(path) ? NodeFs.readdirSync(path) : [])),
  ),
  readText: Effect.fn("Files.readText")((path: string) =>
    attempt("read", path, () =>
      NodeFs.existsSync(path) ? Option.some(NodeFs.readFileSync(path, "utf8")) : Option.none(),
    ),
  ),
  writeTextAtomic: Effect.fn("Files.writeTextAtomic")((path: string, text: string) =>
    attempt("write", path, () => {
      NodeFs.mkdirSync(NodePath.dirname(path), { recursive: true });
      const temp = `${path}.${process.pid}.tmp`;
      NodeFs.writeFileSync(temp, text);
      NodeFs.renameSync(temp, path);
    }),
  ),
  append: Effect.fn("Files.append")((path: string, text: string) =>
    attempt("append to", path, () => {
      NodeFs.mkdirSync(NodePath.dirname(path), { recursive: true });
      NodeFs.appendFileSync(path, text);
    }),
  ),
  exists: Effect.fn("Files.exists")((path: string) => Effect.sync(() => NodeFs.existsSync(path))),
  remove: Effect.fn("Files.remove")((path: string) =>
    attempt("remove", path, () => NodeFs.rmSync(path, { force: true })),
  ),
});

export const layer = Layer.succeed(Files, make);
