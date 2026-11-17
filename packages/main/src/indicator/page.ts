// The desktop indicator window's page. Main sends it the text to show and probes; it answers a
// probe only once two frames have run with its Stop button in place.
import type { ToIndicator } from "@t3mode/shared/Backends";

interface IndicatorBridge {
  readonly onModel: (listener: (message: ToIndicator) => void) => void;
  readonly painted: (epoch: string, n: number) => void;
  readonly stop: (epoch: string) => void;
}

const CSS = `
:root { color-scheme: dark; }
html, body { margin: 0; height: 100%; overflow: hidden; background: #18181b; }
body { font: 13px/1.2 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; color: #fafafa;
  user-select: none; cursor: default; }
#pill { box-sizing: border-box; height: 100%; display: flex; align-items: center; gap: 10px;
  padding: 0 6px 0 14px; border: 1px solid #3f3f46; border-radius: 10px; background: #27272a; }
#dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #f97316;
  box-shadow: 0 0 0 3px rgb(249 115 22 / 0.25); }
#text { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#detail { margin-left: 8px; color: #a1a1aa; }
#stop { flex: none; min-width: 72px; height: 30px; padding: 0 14px; border: 0; border-radius: 7px;
  font: 600 13px "Segoe UI", system-ui, sans-serif; color: #fff; background: #dc2626; cursor: pointer; }
#stop:hover { background: #ef4444; }
#stop:disabled { color: #d4d4d8; background: #52525b; cursor: default; }
`;

const bridge = (window as unknown as { readonly t3modeIndicator: IndicatorBridge }).t3modeIndicator;
const element = (id: string) => document.getElementById(id) as HTMLElement;
const label = element("label");
const detail = element("detail");
const stop = element("stop") as HTMLButtonElement;
let epoch: string | undefined;

const sheet = new CSSStyleSheet();
sheet.replaceSync(CSS);
document.adoptedStyleSheets = [sheet];

stop.addEventListener("click", () => {
  if (epoch === undefined || stop.disabled) return;
  stop.disabled = true;
  stop.textContent = "Stopping…";
  bridge.stop(epoch);
});

bridge.onModel((message) => {
  if (message.op === "render") {
    epoch = message.epoch;
    label.textContent = message.label;
    detail.textContent = message.detail ?? "";
    detail.hidden = message.detail === null;
    return;
  }
  if (message.epoch !== epoch || stop.disabled) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (document.visibilityState === "visible" && stop.isConnected && !stop.disabled) {
        bridge.painted(message.epoch, message.n);
      }
    }),
  );
});
