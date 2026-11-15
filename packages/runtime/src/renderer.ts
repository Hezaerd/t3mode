// Milestone 1 renderer: proves injection end to end with a small badge, then reports ready.
// The plugin runtime replaces this in milestone 2.
import type { NativeBridge } from "@t3mode/shared/Ipc";

declare global {
  interface Window {
    readonly t3modeNative?: NativeBridge;
    __t3modeRenderer?: boolean;
  }
}

const BADGE_ATTRIBUTE = "data-t3mode-badge";

const showBadge = (text: string): void => {
  document.querySelector(`[${BADGE_ATTRIBUTE}]`)?.remove();
  const badge = document.createElement("div");
  badge.setAttribute(BADGE_ATTRIBUTE, "");
  badge.textContent = text;
  Object.assign(badge.style, {
    position: "fixed",
    right: "12px",
    bottom: "12px",
    zIndex: "2147483647",
    padding: "2px 8px",
    borderRadius: "999px",
    font: "600 11px/18px system-ui, sans-serif",
    color: "#fff",
    background: "rgba(124, 58, 237, 0.85)",
    pointerEvents: "none",
  });
  document.body.append(badge);
};

const main = async (): Promise<void> => {
  const native = window.t3modeNative;
  if (!native || window.__t3modeRenderer) return;
  window.__t3modeRenderer = true;
  try {
    const info = await native.info();
    showBadge(`t3mode ${info.t3modeVersion}`);
    await native.ready();
    await native.log("info", `Renderer started on T3 Code ${info.t3codeVersion}`);
  } catch (error) {
    await native.log(
      "error",
      `Renderer failed: ${error instanceof Error ? error.stack : String(error)}`,
    );
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void main(), { once: true });
} else {
  void main();
}
