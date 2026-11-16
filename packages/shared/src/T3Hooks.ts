export interface T3Hook {
  readonly attribute: string;
  readonly value?: string;
}

export const T3_HOOKS = {
  pane: { attribute: "data-workspace-area", value: "settings" },
  nav: { attribute: "data-workspace-area", value: "settings-nav" },
  section: { attribute: "data-settings-section" },
  capture: { attribute: "data-keybinding-capture" },
  keybinding: { attribute: "id", value: "keybinding-" },
  badge: { attribute: "data-slot", value: "badge" },
} as const satisfies Readonly<Record<string, T3Hook>>;

export const hookSelector = (hook: T3Hook): string =>
  hook.value === undefined ? `[${hook.attribute}]` : `[${hook.attribute}="${hook.value}"]`;
