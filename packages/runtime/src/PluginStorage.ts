import type { PluginApi } from "@t3mode/plugin-sdk";
import type { PluginData } from "@t3mode/shared/Plugins";

export const pluginStorage = (
  data: Map<string, Record<string, unknown>>,
  write: (id: string, record: PluginData) => Promise<void>,
  warn: (message: string) => void,
) => {
  const pending = new Map<
    string,
    { latest: PluginData | undefined; done: PromiseWithResolvers<void> }
  >();
  const persist = async (id: string, record: PluginData): Promise<void> => {
    const active = pending.get(id);
    if (active) {
      active.latest = record;
      return;
    }
    const state = {
      latest: undefined as PluginData | undefined,
      done: Promise.withResolvers<void>(),
    };
    pending.set(id, state);
    let next: PluginData | undefined = record;
    while (next) {
      state.latest = undefined;
      try {
        // Each plugin must finish its current write before persisting a newer record.
        // eslint-disable-next-line no-await-in-loop
        await write(id, next);
      } catch (error) {
        warn(`Plugin ${id} could not store data: ${String(error)}`);
      }
      next = state.latest;
    }
    pending.delete(id);
    state.done.resolve();
  };
  const storage = (id: string): PluginApi["storage"] => ({
    get: (key, fallback) => {
      const record = data.get(id);
      return record && Object.hasOwn(record, key)
        ? (JSON.parse(JSON.stringify(record[key])) as typeof fallback)
        : fallback;
    },
    set: (key, value) => {
      try {
        const normalized: unknown = JSON.parse(JSON.stringify(value));
        const record = { ...data.get(id), [key]: normalized };
        data.set(id, record);
        void persist(id, record);
      } catch (error) {
        warn(`Plugin ${id} could not store ${key}: ${String(error)}`);
      }
    },
  });
  return {
    storage,
    flush: (id: string): Promise<void> => pending.get(id)?.done.promise ?? Promise.resolve(),
  };
};
