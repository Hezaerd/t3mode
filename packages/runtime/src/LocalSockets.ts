import type { LocalSocket } from "@t3mode/plugin-sdk";
import type { NativeBridge, SocketEvent } from "@t3mode/shared/Ipc";

export const localSockets = (native: NativeBridge) => {
  const listeners = new Map<number, (event: SocketEvent) => void>();
  const early = new Map<number, Array<SocketEvent>>();
  let pending = 0;
  let subscribed = false;
  return async (
    plugin: string,
    name: string,
    alive: () => boolean,
    guard: <A extends ReadonlyArray<unknown>>(
      callback: (...args: A) => void,
    ) => (...args: A) => void,
    add: (cleanup: () => void) => void,
  ): Promise<LocalSocket> => {
    if (!alive()) throw new Error("The plugin has stopped.");
    if (!subscribed) {
      native.onSocketEvent((event) => {
        const listener = listeners.get(event.id);
        if (listener) listener(event);
        else if (pending > 0) {
          const queue = early.get(event.id) ?? [];
          queue.push(event);
          early.set(event.id, queue);
        }
      });
      subscribed = true;
    }
    pending++;
    try {
      const result = await native.socket.connect(plugin, name);
      if (!result.ok) throw new Error(result.error);
      const id = result.value;
      const dataListeners: Array<(data: Uint8Array) => void> = [];
      const closeListeners: Array<(error?: string) => void> = [];
      // Bytes can arrive before the plugin calls onData, even before the connect reply.
      let unread: Array<Uint8Array> | undefined = [];
      let state: { kind: "open" } | { kind: "closed"; error?: string } = { kind: "open" };
      const closed = (error?: string) => {
        if (state.kind === "closed") return;
        state = { kind: "closed", ...(error === undefined ? {} : { error }) };
        listeners.delete(id);
        for (const callback of closeListeners) callback(error);
      };
      const close = () => {
        if (state.kind === "closed") return;
        void native.socket.close(id).catch(() => undefined);
        closed();
      };
      if (!alive()) {
        close();
        throw new Error("The plugin stopped while connecting.");
      }
      const listener = (event: SocketEvent) => {
        if (event._tag === "closed") closed(event.error);
        else if (unread) unread.push(event.data);
        else for (const callback of dataListeners) callback(event.data);
      };
      listeners.set(id, listener);
      add(close);
      for (const event of early.get(id) ?? []) listener(event);
      early.delete(id);
      return {
        name,
        write: (data) => {
          if (!alive() || state.kind === "closed") return;
          void native.socket.write(id, data).catch((error: unknown) => {
            close();
            guard(() => {
              throw error;
            })();
          });
        },
        close,
        onData: (callback) => {
          const guarded = guard(callback);
          dataListeners.push(guarded);
          const pendingData = unread;
          unread = undefined;
          for (const data of pendingData ?? []) guarded(data);
        },
        onClose: (callback) => {
          if (state.kind === "closed") guard(callback)(state.error);
          else closeListeners.push(guard(callback));
        },
      };
    } finally {
      pending--;
      if (pending === 0) early.clear();
    }
  };
};
