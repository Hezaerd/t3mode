// t3mode's own CSS: toasts, and the layout of the settings page around T3 Code's components
// (native.ts). Colors come from T3 Code's theme variables, so the page follows the active
// theme, light or dark, with fallbacks if a variable disappears.

import { SHORTCUT_COMMAND } from "@t3mode/shared/Shortcut";
import { T3_HOOKS, hookSelector } from "@t3mode/shared/T3Hooks";

const STYLE_ATTRIBUTE = "data-t3mode-ui";
const SHORTCUT_BADGE = `${hookSelector({ ...T3_HOOKS.keybinding, value: `${T3_HOOKS.keybinding.value}${SHORTCUT_COMMAND}` })} ${hookSelector(T3_HOOKS.badge)}`;

const CSS = `
[data-t3mode-toasts] {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
  display: flex; flex-direction: column; gap: 8px; max-width: 360px; pointer-events: none;
}
.t3mode-toast {
  padding: 10px 12px; border-radius: 12px; font: 13px/1.4 var(--font-sans, system-ui, sans-serif);
  color: var(--popover-foreground, #f5f5f5); background: var(--popover, #1c1c1c);
  border: 1px solid var(--border, rgba(255,255,255,.1)); box-shadow: 0 8px 24px rgba(0,0,0,.35);
}
.t3mode-toast-error { border-color: var(--destructive, #e5484d); }

/* While t3mode's page is open, React's own page stays mounted but hidden. */
[data-t3mode-page-open] > :not([data-t3mode-page]) { display: none !important; }

[data-t3mode-page] .t3mode-primary {
  background: var(--primary); color: var(--primary-foreground); --control-icon-color: var(--primary-foreground);
}
[data-t3mode-page] .t3mode-primary:hover { background: color-mix(in oklab, var(--primary) 90%, var(--foreground)); }
[data-t3mode-page] .t3mode-plugins-section > :first-child { padding-right: 0; }
[data-t3mode-page] .t3mode-offer { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 12px 16px; }
[data-t3mode-page] .t3mode-offer + .t3mode-offer { border-top: 1px solid var(--border); }
[data-t3mode-page] .t3mode-offer-text { min-width: 0; display: flex; flex-direction: column; gap: 6px; overflow-wrap: anywhere; }
[data-t3mode-page] .t3mode-install-footer { border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; }
[data-t3mode-page] .t3mode-install-footer .t3mode-actions { justify-content: flex-end; }
[data-t3mode-page] .t3mode-install-panel .t3mode-install-error { padding: 0; }
[data-t3mode-page] .t3mode-card-highlight { animation: t3mode-installed 2.4s ease-out both; }
@keyframes t3mode-installed {
  from { box-shadow: 0 0 0 2px var(--ring); background-color: color-mix(in oklab, var(--primary) 18%, var(--card)); }
  to { box-shadow: 0 0 0 0 transparent; }
}
@media (prefers-reduced-motion: reduce) {
  [data-t3mode-page] .t3mode-card { animation-duration: 0s !important; }
}
[data-t3mode-page] .t3mode-toolbar { display: flex; gap: 8px; align-items: center; }
[data-t3mode-page] .t3mode-search { flex: 1; width: auto; cursor: text; }
[data-t3mode-page] .t3mode-search:focus-within {
  border-color: var(--ring); box-shadow: inset 0 0 0 3px color-mix(in oklab, var(--ring) 24%, transparent);
}
[data-t3mode-page] .t3mode-search-input {
  flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; outline: 0;
  background: transparent; color: inherit; font: inherit;
}
[data-t3mode-page] .t3mode-search-input::placeholder { color: var(--muted-foreground); opacity: .8; }
[data-t3mode-page] .t3mode-search-input::-webkit-search-cancel-button { display: none; }
[data-t3mode-page] .t3mode-count { font-size: var(--text-xs, 12px); color: var(--muted-foreground); }
[data-t3mode-page] .t3mode-path { font-family: var(--font-mono, ui-monospace, monospace); word-break: break-all; }

[data-t3mode-page] .t3mode-grid {
  display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
}
[data-t3mode-page] .t3mode-card {
  display: flex; flex-direction: column; gap: 6px; padding: 12px 12px 12px 16px; min-height: 124px;
  cursor: pointer; transition: border-color .15s, background-color .15s;
}
[data-t3mode-page] .t3mode-card:hover {
  border-color: color-mix(in oklab, var(--border) 100%, var(--foreground) 6%);
  background-color: color-mix(in oklab, var(--card) 70%, var(--accent));
}
[data-t3mode-page] .t3mode-card-head { display: flex; align-items: center; gap: 6px; min-height: 28px; }
[data-t3mode-page] .t3mode-card-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-t3mode-page] .t3mode-card-head [role="switch"] { margin-left: 4px; }
[data-t3mode-page] .t3mode-card-description { flex: 1; padding-right: 4px; }
[data-t3mode-page] .t3mode-card-foot { display: flex; align-items: center; gap: 8px; min-height: 24px; }
[data-t3mode-page] .t3mode-empty { padding: 4px 16px; }
[data-t3mode-page] .t3mode-actions { display: flex; align-items: center; gap: 8px; }
[data-t3mode-page] .t3mode-card-meta {
  margin-top: -6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: var(--text-xs, 12px); color: var(--muted-foreground);
}
[data-t3mode-page] .t3mode-install { display: flex; flex-direction: column; gap: 10px; }
[data-t3mode-page] .t3mode-install-error { padding: 0 16px; font-size: var(--text-xs, 12px); color: var(--destructive-foreground, #ff8a8a); }
[data-t3mode-page] .t3mode-confirm { display: flex; flex-direction: column; gap: 6px; padding: 12px 16px; }
[data-t3mode-page] .t3mode-confirm .t3mode-actions { margin-top: 4px; }
[data-t3mode-page] .t3mode-warning { display: flex; align-items: flex-start; gap: 6px; font-size: var(--text-xs, 12px); color: var(--foreground); }
[data-t3mode-page] .t3mode-warning svg { flex: none; width: 14px; height: 14px; margin-top: 1px; color: var(--warning, #f5a524); }

[data-t3mode-page] .t3mode-status {
  display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;
  font-size: var(--text-xs, 12px); color: var(--muted-foreground);
}
[data-t3mode-page] .t3mode-status-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-t3mode-page] .t3mode-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .6; }
[data-t3mode-page] .t3mode-status[data-tone="active"] .t3mode-dot { color: var(--success, #3fb950); opacity: 1; }
[data-t3mode-page] .t3mode-status[data-tone="waiting"] .t3mode-dot { color: var(--warning, #f5a524); opacity: 1; }
[data-t3mode-page] .t3mode-status[data-tone="failed"] { color: var(--destructive-foreground, #ff8a8a); }
[data-t3mode-page] .t3mode-status[data-tone="failed"] .t3mode-dot { opacity: 1; }

[data-t3mode-page] .t3mode-crumb-link {
  padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer;
}
[data-t3mode-page] .t3mode-crumb-link:hover { color: var(--foreground); }
[data-t3mode-page] .t3mode-select-positioner { position: absolute; z-index: 130; user-select: none; }
[data-t3mode-page] [data-slot="select-list"]:focus { outline: none; }

/* Settings → Keybindings lists T3 Mode's shortcut as a project script; badge it "T3 Mode" instead. */
${SHORTCUT_BADGE} { font-size: 0; }
${SHORTCUT_BADGE}::after {
  content: "T3 Mode"; font-size: .75rem;
}
@media (min-width: 640px) {
  ${SHORTCUT_BADGE}::after { font-size: .625rem; }
}
`;

export const ensureStyles = (): void => {
  if (document.head.querySelector(`[${STYLE_ATTRIBUTE}]`)) return;
  const style = document.createElement("style");
  style.setAttribute(STYLE_ATTRIBUTE, "");
  style.textContent = CSS;
  document.head.append(style);
};
