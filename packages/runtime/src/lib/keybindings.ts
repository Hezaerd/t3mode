// Reading T3 Code's keybindings from the page, to handle T3 Mode's own shortcut the way T3 Code
// handles its commands: same rules, same "When" clauses, last matching rule wins. Mirrors
// `resolveShortcutCommand` in T3 Code's apps/web/src/keybindings.ts.
import { findHookState } from "./react.ts";

export interface Shortcut {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  /** Cmd on macOS, Ctrl elsewhere. */
  readonly modKey: boolean;
}

export type WhenNode =
  | { readonly type: "identifier"; readonly name: string }
  | { readonly type: "not"; readonly node: WhenNode }
  | { readonly type: "and" | "or"; readonly left: WhenNode; readonly right: WhenNode };

export interface ResolvedRule {
  readonly command: string;
  readonly shortcut: Shortcut;
  readonly whenAst?: WhenNode;
}

export interface KeyEventLike {
  readonly key: string;
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export type WhenContext = Readonly<Record<string, boolean>>;

/** The resolved keybindings T3 Code keeps in React state. */
export const isResolvedRules = (value: unknown): value is ReadonlyArray<ResolvedRule> =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (rule) =>
      typeof rule === "object" &&
      rule !== null &&
      typeof (rule as ResolvedRule).command === "string" &&
      typeof (rule as ResolvedRule).shortcut === "object" &&
      typeof (rule as ResolvedRule).shortcut?.key === "string",
  );

const KEY_NAMES: Readonly<Record<string, string>> = { " ": "space", esc: "escape" };

/** Every name the event's key goes by: its character, and its physical key for letters and digits. */
export const eventKeys = (event: KeyEventLike): ReadonlySet<string> => {
  const key = event.key.toLowerCase();
  const keys = new Set([KEY_NAMES[key] ?? key]);
  const physical = /^Key([A-Z])$/.exec(event.code) ?? /^Digit(\d)$/.exec(event.code);
  if (physical?.[1]) keys.add(physical[1].toLowerCase());
  return keys;
};

export const matchesShortcut = (event: KeyEventLike, shortcut: Shortcut, isMac: boolean) => {
  const meta = shortcut.metaKey || (shortcut.modKey && isMac);
  const ctrl = shortcut.ctrlKey || (shortcut.modKey && !isMac);
  return (
    event.metaKey === meta &&
    event.ctrlKey === ctrl &&
    event.altKey === shortcut.altKey &&
    event.shiftKey === shortcut.shiftKey &&
    eventKeys(event).has(shortcut.key.toLowerCase())
  );
};

export const evaluateWhen = (node: WhenNode | undefined, context: WhenContext): boolean => {
  if (!node) return true;
  switch (node.type) {
    case "identifier":
      if (node.name === "true") return true;
      if (node.name === "false") return false;
      return context[node.name] === true;
    case "not":
      return !evaluateWhen(node.node, context);
    case "and":
      return evaluateWhen(node.left, context) && evaluateWhen(node.right, context);
    case "or":
      return evaluateWhen(node.left, context) || evaluateWhen(node.right, context);
  }
};

/** The command the event triggers, as T3 Code resolves it: the last matching rule wins. */
export const resolveCommand = (
  event: KeyEventLike,
  rules: ReadonlyArray<ResolvedRule>,
  context: WhenContext,
  isMac: boolean,
): string | null => {
  for (let index = rules.length - 1; index >= 0; index--) {
    const rule = rules[index];
    if (
      rule &&
      evaluateWhen(rule.whenAst, context) &&
      matchesShortcut(event, rule.shortcut, isMac)
    ) {
      return rule.command;
    }
  }
  return null;
};

/** T3 Code's keybindings, or undefined when their shape changed. */
export const readKeybindings = (): ReadonlyArray<ResolvedRule> | undefined => {
  const anchor = document.querySelector("#root > *") ?? document.body.firstElementChild;
  return anchor ? findHookState(anchor, isResolvedRules) : undefined;
};

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.matches("input, textarea, select, [role=textbox]"));

/** The "When" identifiers T3 Code sets from focus. Others read as false. */
export const focusContext = (event: KeyboardEvent): WhenContext => {
  const active = document.activeElement;
  return {
    isDesktop: true,
    isWeb: false,
    terminalFocus: active instanceof Element && active.closest(".xterm") !== null,
    terminalOpen: document.querySelector(".xterm") !== null,
    editableFocus: isEditable(event.target),
  };
};

export const isMacPlatform = () => /mac|iphone|ipad/i.test(navigator.platform);
