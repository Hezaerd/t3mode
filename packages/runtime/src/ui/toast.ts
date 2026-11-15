import { h } from "../dom.ts";
import { ensureStyles } from "./styles.ts";

const STACK_ATTRIBUTE = "data-t3mode-toasts";

/** A small message in the bottom-right corner, gone after a few seconds. */
export const toast = (message: string, kind: "info" | "error" = "info"): void => {
  ensureStyles();
  let stack = document.querySelector<HTMLElement>(`[${STACK_ATTRIBUTE}]`);
  if (!stack) {
    stack = h("div", { attrs: { [STACK_ATTRIBUTE]: "", role: "status", "aria-live": "polite" } });
    document.body.append(stack);
  }
  const item = h("div", { className: `t3mode-toast t3mode-toast-${kind}`, text: message });
  stack.append(item);
  window.setTimeout(() => item.remove(), kind === "error" ? 8000 : 4000);
};
