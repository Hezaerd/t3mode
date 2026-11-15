// @effect-diagnostics nodeBuiltinImport:off
import * as Net from "node:net";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { WebContents } from "electron";
import { Channel, type SocketEvent } from "@t3mode/shared/Ipc";
import {
  socketAllowed,
  SOCKET_NAME_PATTERN,
  type InstalledPlugin,
  type PluginResult,
} from "@t3mode/shared/Plugins";
import { PluginIdSchema } from "@t3mode/shared/PluginStore";
import { PluginHost } from "./PluginHost.ts";

const Id = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0));
export const SocketActionSchema = Schema.Union([
  Schema.TaggedStruct("connect", {
    plugin: PluginIdSchema,
    name: Schema.String.check(Schema.isPattern(SOCKET_NAME_PATTERN)),
  }),
  Schema.TaggedStruct("write", { id: Id, data: Schema.Uint8Array }),
  Schema.TaggedStruct("close", { id: Id }),
]);

export class SocketError extends Schema.TaggedError<SocketError>()("SocketError", {
  message: Schema.String,
}) {}

type State =
  | { readonly kind: "connecting"; readonly resolve: (result: PluginResult<number>) => void }
  | { readonly kind: "open" }
  | { readonly kind: "closed" };

type Connection = {
  readonly socket: Net.Socket;
  readonly owner: WebContents;
  readonly plugin: string;
  state: State;
};

const send = (owner: WebContents, event: SocketEvent) => {
  if (!owner.isDestroyed()) owner.send(Channel.socketEvent, event);
};

export const makeRegistry = () => {
  const connections = new Map<number, Connection>();
  const owners = new Map<WebContents, () => void>();
  let nextId = 1;
  const finish = (id: number, error?: string) => {
    const entry = connections.get(id);
    if (!entry) return;
    const previous = entry.state;
    entry.state = { kind: "closed" };
    connections.delete(id);
    entry.socket.destroy();
    if (![...connections.values()].some((other) => other.owner === entry.owner)) {
      owners.get(entry.owner)?.();
      owners.delete(entry.owner);
    }
    if (previous.kind === "connecting")
      previous.resolve({ ok: false, error: error ?? "Connection closed before it opened." });
    else if (previous.kind === "open")
      send(entry.owner, { _tag: "closed", id, ...(error === undefined ? {} : { error }) });
  };
  const watch = (owner: WebContents) => {
    if (owners.has(owner)) return;
    const closeAll = () => {
      for (const [id, entry] of connections) if (entry.owner === owner) finish(id);
    };
    const navigate = (_event: unknown, _url: string, _inPlace: boolean, mainFrame: boolean) => {
      if (mainFrame) closeAll();
    };
    owner.on("destroyed", closeAll);
    owner.on("render-process-gone", closeAll);
    // did-start-navigation fires for reloads as well as navigations, before the old page exits.
    owner.on("did-start-navigation", navigate);
    owners.set(owner, () => {
      owner.removeListener("destroyed", closeAll);
      owner.removeListener("render-process-gone", closeAll);
      owner.removeListener("did-start-navigation", navigate);
    });
  };
  const connect = (
    owner: WebContents,
    plugin: InstalledPlugin | undefined,
    name: string,
  ): Promise<PluginResult<number>> => {
    if (!plugin || plugin.error !== undefined || !socketAllowed(plugin.sockets ?? [], name))
      return Promise.resolve({
        ok: false,
        error: `Socket ${name} is not declared by this installed plugin.`,
      });
    if (process.platform !== "win32")
      return Promise.resolve({ ok: false, error: "Local sockets are supported only on Windows." });
    if (owner.isDestroyed()) return Promise.resolve({ ok: false, error: "The page has closed." });
    if ([...connections.values()].filter((entry) => entry.plugin === plugin.id).length >= 8)
      return Promise.resolve({ ok: false, error: "This plugin already has 8 local sockets open." });
    return new Promise((resolve) => {
      const id = nextId++;
      const socket = new Net.Socket();
      const entry: Connection = {
        socket,
        owner,
        plugin: plugin.id,
        state: { kind: "connecting", resolve },
      };
      connections.set(id, entry);
      watch(owner);
      socket.on("connect", () => {
        if (entry.state.kind !== "connecting") return;
        entry.state = { kind: "open" };
        resolve({ ok: true, value: id });
      });
      socket.on("data", (data) => send(owner, { _tag: "data", id, data: new Uint8Array(data) }));
      socket.on("error", (error: NodeJS.ErrnoException) =>
        finish(
          id,
          error.code === "ENOENT"
            ? `Nothing is listening on ${name}.`
            : `Could not use ${name}: ${error.message}`,
        ),
      );
      socket.on("close", () => finish(id));
      socket.connect("\\\\.\\pipe\\" + name);
    });
  };
  const owned = (owner: WebContents, id: number) => {
    const entry = connections.get(id);
    if (!entry || entry.owner !== owner || entry.state.kind !== "open")
      throw new SocketError({ message: "Unknown local socket for this page." });
    return entry;
  };
  return {
    connect,
    write: (owner: WebContents, id: number, data: Uint8Array) => {
      const entry = owned(owner, id);
      if (data.byteLength > 1024 * 1024)
        throw new SocketError({ message: "A socket write cannot exceed 1 MiB." });
      entry.socket.write(data);
    },
    close: (owner: WebContents, id: number) => {
      owned(owner, id);
      finish(id);
    },
  };
};

export class LocalSockets extends Context.Service<
  LocalSockets,
  {
    readonly act: (
      input: unknown,
      owner: WebContents,
    ) => Effect.Effect<PluginResult<number> | void, Schema.SchemaError | SocketError>;
  }
>()("@t3mode/main/LocalSockets") {}

export const make = Effect.gen(function* () {
  const plugins = yield* PluginHost;
  const registry = makeRegistry();
  return LocalSockets.of({
    act: Effect.fn("LocalSockets.act")(function* (input: unknown, owner: WebContents) {
      const action = yield* Schema.decodeUnknownEffect(SocketActionSchema)(input);
      if (action._tag === "connect") {
        const plugin = (yield* plugins.list).find((entry) => entry.id === action.plugin);
        return yield* Effect.promise(() => registry.connect(owner, plugin, action.name));
      }
      yield* Effect.try({
        try: () =>
          action._tag === "write"
            ? registry.write(owner, action.id, action.data)
            : registry.close(owner, action.id),
        catch: (error) =>
          Schema.is(SocketError)(error) ? error : new SocketError({ message: String(error) }),
      });
    }),
  });
});
export const layer = Layer.effect(LocalSockets, make);
