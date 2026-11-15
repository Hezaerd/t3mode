// settings.json in the t3mode home. The main process validates and stores it; the page
// runtime reads it once at start and writes the whole file back on every change.

export interface PluginSettings {
  readonly enabled?: boolean;
  readonly options?: Readonly<Record<string, unknown>>;
}

export interface UpdateSettings {
  /** t3mode installs T3 Code updates (default). Off: T3 Code's own updater runs, and each update removes t3mode. */
  readonly manage?: boolean;
}

export interface Settings {
  readonly version: 1;
  readonly plugins: Readonly<Record<string, PluginSettings>>;
  readonly updates?: UpdateSettings;
}

export const managesUpdates = (settings: Settings): boolean => settings.updates?.manage ?? true;

export const defaultSettings: Settings = { version: 1, plugins: {} };
