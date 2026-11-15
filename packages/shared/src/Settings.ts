// settings.json in the t3mode home. The main process validates and stores it; the page
// runtime reads it once at start and writes the whole file back on every change.

export interface PluginSettings {
  readonly enabled?: boolean;
  readonly options?: Readonly<Record<string, unknown>>;
}

export interface Settings {
  readonly version: 1;
  readonly plugins: Readonly<Record<string, PluginSettings>>;
}

export const defaultSettings: Settings = { version: 1, plugins: {} };
