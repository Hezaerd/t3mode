// T3 Mode's pages inside T3 Code's settings. A "T3 Mode" group in the settings navigation holds
// two entries, like Vencord's: "T3 Mode" (version, updates, shortcut, troubleshooting) and
// "Plugins" (install from GitHub, a card grid with search and filter, and a page per plugin for
// its options and source). Pages open in the settings content pane, built from T3 Code's own
// components (see native.ts).
//
// The pane is React's. t3mode adds its page as the pane's last child and hides React's
// children with CSS while it is open, so React's nodes are never moved or removed.
import {
  accessLines,
  declaredAccess,
  type InstalledPlugin,
  type PluginPreview,
  type PluginOffer,
  sourceLabel,
} from "@t3mode/shared/Plugins";
import { T3_HOOKS, hookSelector } from "@t3mode/shared/T3Hooks";

import { h } from "../dom.ts";
import type { PluginState, Runtime } from "../Runtime.ts";
import { icon, type IconName } from "./icons.ts";
import {
  button,
  group,
  iconButton,
  native,
  row,
  section,
  selectControl,
  switchControl,
} from "./native.ts";
import { ensureStyles } from "./styles.ts";
import { toast } from "./toast.ts";
import { updatesSection } from "./updatesSection.ts";

const NAV_ATTRIBUTE = "data-t3mode-nav";
const NAV_GROUP_ATTRIBUTE = "data-t3mode-nav-group";
const NAME = "T3 Mode";
const PAGE_ATTRIBUTE = "data-t3mode-page";
const OPEN_ATTRIBUTE = "data-t3mode-page-open";
const SETTINGS_ROUTE = "#/settings/general";

const sel = {
  pane: hookSelector(T3_HOOKS.pane),
  nav: hookSelector(T3_HOOKS.nav),
  section: `button${hookSelector(T3_HOOKS.section)}`,
  close: 'header button[aria-label="Close"]',
} as const;

export type View =
  | { readonly kind: "home" }
  | { readonly kind: "plugins" }
  | { readonly kind: "plugin"; readonly id: string };

type NavKey = "home" | "plugins";
const navKeyOf = (view: View): NavKey => (view.kind === "home" ? "home" : "plugins");
type Filter = "all" | "enabled" | "disabled";

const FILTERS = [
  { value: "all", label: "All plugins" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
] as const;

type Tone = "active" | "waiting" | "failed" | "off";

type InstallStep =
  | { readonly kind: "idle" }
  | { readonly kind: "reading" }
  | { readonly kind: "failed"; readonly error: string }
  | {
      readonly kind: "confirm";
      readonly preview: PluginPreview;
      readonly installed: ReadonlyArray<string>;
    }
  | {
      readonly kind: "installing";
      readonly preview: PluginPreview;
      readonly installed: ReadonlyArray<string>;
      readonly id: string;
    };

const canRetry = (runtime: Runtime, plugin: InstalledPlugin): boolean => {
  const kind = runtime.state(plugin.id).kind;
  return (
    kind === "failed" ||
    (kind === "unavailable" && (plugin.error === undefined || plugin.source.kind === "local")) ||
    runtime.backendStatus(plugin.id)?.state === "failed"
  );
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const busy = async (control: HTMLButtonElement, action: () => Promise<void>): Promise<void> => {
  control.disabled = true;
  try {
    await action();
  } finally {
    control.disabled = false;
  }
};

const fragment = (...nodes: ReadonlyArray<Node | null>): DocumentFragment => {
  const result = document.createDocumentFragment();
  for (const node of nodes) if (node) result.append(node);
  return result;
};

const status = (runtime: Runtime, plugin: InstalledPlugin): { tone: Tone; text: string } => {
  const state: PluginState = runtime.state(plugin.id);
  // A backend that crashed says more than the page code's own status.
  const backend = runtime.backendStatus(plugin.id);
  if (state.kind !== "failed" && state.kind !== "unavailable") {
    if (backend?.state === "failed") {
      return {
        tone: "failed",
        text: `Backend stopped after ${backend.crashes} crashes: ${backend.error}`,
      };
    }
    if (backend?.state === "restarting") {
      return { tone: "waiting", text: `Backend restarting after a crash: ${backend.error}` };
    }
  }
  switch (state.kind) {
    case "off":
      return { tone: "off", text: runtime.isEnabled(plugin.id) ? "Starting" : "Off" };
    case "failed":
      return { tone: "failed", text: `Stopped after an error: ${state.error.split("\n")[0]}` };
    case "unavailable":
      return { tone: "failed", text: `Can't load: ${state.reason}` };
    case "running":
      if (!state.report) return { tone: "active", text: "Running" };
      return {
        tone: state.report.state,
        text: `${state.report.state === "active" ? "Active" : "Waiting"}: ${state.report.detail}`,
      };
  }
};

const statusLine = (runtime: Runtime, plugin: InstalledPlugin) => {
  const { tone, text } = status(runtime, plugin);
  return h(
    "div",
    { className: "t3mode-status", attrs: { "data-tone": tone }, title: text },
    h("span", { className: "t3mode-dot" }),
    h("span", { className: "t3mode-status-text", text }),
  );
};

const crumbSeparator = () =>
  h("li", { className: native.crumbSeparator, attrs: { "aria-hidden": "true" }, text: "/" });
const crumbCurrent = (text: string) =>
  h("li", { className: native.crumbCurrent, attrs: { "aria-current": "page" }, text });

/** Section paths look like `/settings/general`, routes like `#/settings/general?x`. */
const currentSection = () => location.hash.replace(/^#/, "").split("?")[0];

export class SettingsPage {
  readonly #runtime: Runtime;
  #view: View = { kind: "plugins" };
  #query = "";
  #filter: Filter = "all";
  #link = "";
  #step: InstallStep = { kind: "idle" };
  #installBox: HTMLElement | null = null;
  #root: HTMLElement | null = null;
  #body: HTMLElement | null = null;
  #grid: HTMLElement | null = null;
  #teardown: Array<() => void> = [];
  #openRequestedAt = 0;

  constructor(runtime: Runtime) {
    this.#runtime = runtime;
  }

  /** Opens a page, opening T3 Code's settings first when they are closed. */
  open(view: View = { kind: "plugins" }): void {
    this.#view = view;
    const pane = document.querySelector<HTMLElement>(sel.pane);
    if (pane) {
      this.#mount(pane);
      return;
    }
    this.#openRequestedAt = performance.now();
    location.hash = SETTINGS_ROUTE;
  }

  /** Run on DOM changes: keeps the nav entry in place and notices when settings close. */
  sync(): void {
    if (this.#root && !this.#root.isConnected) {
      // React can swap the pane while settings load; follow it. No pane means settings closed.
      this.#unmount();
      const pane = document.querySelector<HTMLElement>(sel.pane);
      if (pane) this.#mount(pane);
    }
    if (this.#openRequestedAt > 0) {
      const pane = document.querySelector<HTMLElement>(sel.pane);
      if (pane) {
        this.#openRequestedAt = 0;
        this.#mount(pane);
      } else if (performance.now() - this.#openRequestedAt > 3000) {
        this.#openRequestedAt = 0;
      }
    }
    this.#syncNav();
  }

  // --- mounting ---------------------------------------------------------------------------

  #mount(pane: HTMLElement): void {
    ensureStyles();
    if (this.#root?.isConnected) {
      this.#render();
      return;
    }
    this.#unmount();
    const root = h("div", {
      className: "relative flex min-h-0 min-w-0 flex-1 flex-col",
      attrs: { [PAGE_ATTRIBUTE]: "" },
    });
    this.#root = root;
    pane.setAttribute(OPEN_ATTRIBUTE, "");
    pane.append(root);

    // React marks the section it shows as active; t3mode's entry is active instead while the
    // page is open. React sets the attribute again when its own state changes.
    const reactActive = [
      ...document.querySelectorAll<HTMLElement>(`${sel.section}[data-active="true"]`),
    ];
    for (const item of reactActive) item.setAttribute("data-active", "false");
    this.#teardown.push(() => {
      for (const item of reactActive) {
        if (item.isConnected && item.dataset["settingsSection"] === currentSection()) {
          item.setAttribute("data-active", "true");
        }
      }
      pane.removeAttribute(OPEN_ATTRIBUTE);
    });

    // Any native section closes the page, before React handles the click.
    const nav = document.querySelector<HTMLElement>(sel.nav);
    if (nav) {
      // Typing in the settings search shows its results in the pane, so it closes the page too.
      // Focus alone doesn't: the dialog focuses that box itself when it opens.
      const onNav = (event: Event) => {
        const target = event.target as Element;
        if (target.closest(`[${NAV_GROUP_ATTRIBUTE}]`)) return;
        if (event.type === "input" || target.closest("button, a")) this.close();
      };
      nav.addEventListener("click", onNav, true);
      nav.addEventListener("input", onNav, true);
      this.#teardown.push(() => {
        nav.removeEventListener("click", onNav, true);
        nav.removeEventListener("input", onNav, true);
      });
    }
    // Opening settings from elsewhere sets the hash; its hashchange can arrive after the mount.
    const mountedAt = location.hash;
    const onRoute = () => {
      if (location.hash !== mountedAt) this.close();
    };
    window.addEventListener("hashchange", onRoute);
    this.#teardown.push(() => window.removeEventListener("hashchange", onRoute));
    this.#teardown.push(this.#runtime.subscribe(() => this.#refresh()));

    this.#render();
    this.#syncNav();
    root.querySelector<HTMLElement>("[data-t3mode-focus]")?.focus();
  }

  close(): void {
    this.#unmount();
    this.#syncNav();
  }

  #unmount(): void {
    for (const cleanup of this.#teardown.splice(0).toReversed()) cleanup();
    this.#root?.remove();
    this.#root = null;
    this.#body = null;
    this.#grid = null;
    this.#installBox = null;
  }

  // --- navigation group -------------------------------------------------------------------

  #syncNav(): void {
    const nav = document.querySelector<HTMLElement>(sel.nav);
    if (!nav) return;
    let navGroup = nav.querySelector<HTMLElement>(`[${NAV_GROUP_ATTRIBUTE}]`);
    if (!navGroup) {
      navGroup = this.#buildNavGroup(nav);
      if (!navGroup) return;
    }
    const open = this.#root?.isConnected === true;
    for (const item of navGroup.querySelectorAll<HTMLElement>(`[${NAV_ATTRIBUTE}]`)) {
      const entry = item.querySelector("button");
      const active = open && item.getAttribute(NAV_ATTRIBUTE) === navKeyOf(this.#view);
      if (!entry || entry.getAttribute("data-active") === String(active)) continue;
      entry.setAttribute("data-active", String(active));
      if (active) entry.setAttribute("aria-current", "page");
      else entry.removeAttribute("aria-current");
    }
  }

  /**
   * A copy of T3 Code's "Connections" group (its label and list), renamed and given t3mode's
   * entries, placed right after it. Without labelled groups, the entries go after the last
   * section instead.
   */
  #buildNavGroup(nav: HTMLElement): HTMLElement | null {
    const labels = [...nav.querySelectorAll<HTMLElement>("h3")];
    const label = labels.find((item) => item.textContent.trim() === "Connections") ?? labels.at(-1);
    const template = label?.parentElement;
    const itemTemplate =
      template?.querySelector("li") ?? nav.querySelector(sel.section)?.closest("li");
    if (!itemTemplate) return null;
    const items = [
      this.#navItem(itemTemplate, "home", NAME, "gear"),
      this.#navItem(itemTemplate, "plugins", "Plugins", "puzzle"),
    ];

    if (template && template.querySelector("ul")) {
      const navGroup = template.cloneNode(true) as HTMLElement;
      navGroup.setAttribute(NAV_GROUP_ATTRIBUTE, "");
      const title = navGroup.querySelector("h3");
      if (title) {
        title.textContent = NAME;
        title.id = "t3mode-settings-nav-group";
        navGroup.querySelector("[role=group]")?.setAttribute("aria-labelledby", title.id);
      }
      navGroup.querySelector("ul")?.replaceChildren(...items);
      template.after(navGroup);
      return navGroup;
    }
    const last = [...nav.querySelectorAll(sel.section)].at(-1)?.closest("li");
    if (!last?.parentElement) return null;
    const list = last.parentElement;
    for (const item of items.toReversed()) last.after(item);
    list.setAttribute(NAV_GROUP_ATTRIBUTE, "");
    return list;
  }

  #navItem(template: Element, key: NavKey, text: string, iconName: IconName): HTMLElement {
    const item = template.cloneNode(true) as HTMLElement;
    item.setAttribute(NAV_ATTRIBUTE, key);
    const entry = item.querySelector<HTMLElement>("button");
    if (!entry) return item;
    entry.removeAttribute(T3_HOOKS.section.attribute);
    entry.removeAttribute("aria-current");
    entry.setAttribute("data-active", "false");
    const label = [...entry.querySelectorAll<HTMLElement>("span, div")].findLast(
      (node) => node.children.length === 0 && node.textContent.trim().length > 0,
    );
    if (label) label.textContent = text;
    else entry.textContent = text;
    entry.querySelector("svg")?.replaceWith(icon(iconName));
    entry.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.#root?.isConnected) this.#go({ kind: key });
      else this.open({ kind: key });
    });
    return item;
  }

  // --- rendering --------------------------------------------------------------------------

  #go(view: View): void {
    this.#view = view;
    this.#render();
    this.#syncNav();
    this.#root?.querySelector<HTMLElement>("[data-t3mode-focus]")?.focus();
  }

  /** Plugin state changed: redraw what shows it, keeping the search box and focus. */
  #refresh(): void {
    if (!this.#root) return;
    if (this.#view.kind === "plugins") this.#renderGrid();
    else if (this.#view.kind === "plugin") this.#render();
  }

  #render(): void {
    const root = this.#root;
    if (!root) return;
    const focusedId = document.activeElement?.id;
    const plugin = this.#view.kind === "plugin" ? this.#runtime.plugin(this.#view.id) : undefined;
    if (this.#view.kind === "plugin" && !plugin) this.#view = { kind: "plugins" };

    const body = h("div", { className: native.pageBody });
    this.#body = body;
    root.replaceChildren(
      this.#header(plugin),
      h(
        "div",
        { className: "min-h-0 flex flex-1 flex-col" },
        h("div", { className: native.pageScroll }, body),
      ),
    );
    if (plugin) this.#renderPlugin(body, plugin);
    else if (this.#view.kind === "home") this.#renderHome(body);
    else this.#renderPlugins(body);
    if (focusedId) document.getElementById(focusedId)?.focus();
  }

  #header(plugin: InstalledPlugin | undefined): HTMLElement {
    const crumbs: Array<Node> = [
      h("li", { className: native.crumb, text: "Settings" }),
      crumbSeparator(),
    ];
    if (plugin) {
      crumbs.push(
        h(
          "li",
          { className: native.crumb },
          h("button", {
            className: "t3mode-crumb-link",
            text: "Plugins",
            attrs: { type: "button" },
            on: { click: () => this.#go({ kind: "plugins" }) },
          }),
        ),
        crumbSeparator(),
        crumbCurrent(plugin.name),
      );
    } else {
      crumbs.push(crumbCurrent(this.#view.kind === "home" ? NAME : "Plugins"));
    }
    const nativeClose = document.querySelector<HTMLElement>(`${sel.pane} > ${sel.close}`);
    return h(
      "header",
      { className: native.header },
      h(
        "nav",
        { className: "min-w-0", attrs: { "aria-label": "Settings breadcrumb" } },
        h("ol", { className: native.breadcrumb }, ...crumbs),
      ),
      h(
        "div",
        { className: native.headerActions },
        nativeClose
          ? iconButton({ label: "Close", icon: "x", onClick: () => nativeClose.click() })
          : null,
      ),
    );
  }

  #renderHome(body: HTMLElement): void {
    const runtime = this.#runtime;
    const info = runtime.info;
    const about = group(
      row({
        title: `${NAME} ${info.t3modeVersion}`,
        description: `Plugins for T3 Code, without changing T3 Code itself. Running on T3 Code ${info.t3codeVersion}.`,
      }),
    );
    // The shortcut lives in Settings → Keybindings; this row only appears once it's gone.
    void runtime.shortcut("status").then((shortcutStatus) => {
      if (shortcutStatus !== "missing" || !about.isConnected) return;
      const restore = button({
        text: "Restore",
        icon: "retry",
        variant: "outline",
        onClick: () => {
          void runtime.shortcut("restore").then((next) => {
            if (next === "added" || next === "present") {
              toast(
                "Shortcut restored as Ctrl+Alt+M. Change it in Settings → Keybindings, under T3 Mode Plugins.",
                "info",
              );
              shortcutRow.remove();
            } else {
              toast("T3 Mode could not update T3 Code's keybindings. See its log.", "error");
            }
          });
        },
      });
      const shortcutRow = row({
        title: "Keyboard shortcut",
        description:
          'The shortcut that opens Plugins was removed from Settings → Keybindings. Restore it, then change it there under "T3 Mode Plugins".',
        control: restore,
      });
      about.append(shortcutRow);
    });
    body.append(
      section(NAME, null, about),
      updatesSection(runtime),
      section(
        "Troubleshooting",
        null,
        group(
          row({
            title: "Logs",
            description: h("span", { className: "t3mode-path", text: info.logs }),
            control: button({
              text: "Open folder",
              icon: "folder",
              variant: "outline",
              onClick: () => {
                void runtime.openLogs();
              },
            }),
          }),
          row({
            title: "Safe mode",
            description: `To start T3 Code once without ${NAME}, close it and run "t3mode safe". ${NAME} also skips a launch on its own after failed starts or repeated crashes.`,
          }),
          row({
            title: "Uninstall",
            description: `Close T3 Code and run "t3mode uninstall" to restore its original files.`,
          }),
        ),
      ),
    );
  }

  #renderPlugins(body: HTMLElement): void {
    const runtime = this.#runtime;
    const enabled = runtime.plugins.filter((plugin) => runtime.isEnabled(plugin.id)).length;

    const search = h("input", {
      className: "t3mode-search-input",
      attrs: {
        id: "t3mode-plugin-search",
        type: "search",
        placeholder: "Search plugins",
        "aria-label": "Search plugins",
        autocomplete: "off",
        spellcheck: "false",
      },
      props: { value: this.#query },
      on: {
        input: (event) => {
          this.#query = (event.target as HTMLInputElement).value;
          this.#renderGrid();
        },
        keydown: (event) => {
          // Escape clears the search before it closes the settings dialog.
          if ((event as KeyboardEvent).key === "Escape" && this.#query !== "") {
            event.stopPropagation();
            event.preventDefault();
            this.#query = "";
            (event.target as HTMLInputElement).value = "";
            this.#renderGrid();
          }
        },
      },
    });
    const grid = h("div", { className: "t3mode-grid" });
    this.#grid = grid;
    const check = button({
      text: "Check for updates",
      icon: "retry",
      variant: "outline",
      onClick: () => void busy(check, () => this.#checkUpdates()),
    });
    check.id = "t3mode-plugins-check";

    body.append(
      this.#installSection(),
      section(
        "Plugins",
        h(
          "div",
          { className: "t3mode-actions" },
          h("span", {
            className: "t3mode-count",
            text: `${enabled} of ${runtime.plugins.length} enabled`,
          }),
          check,
        ),
        h(
          "div",
          { className: "t3mode-toolbar" },
          h(
            "label",
            { className: `${native.selectTrigger} t3mode-search` },
            icon("search", "size-3.5"),
            search,
          ),
          selectControl({
            host: this.#root ?? body,
            label: "Filter plugins",
            value: this.#filter,
            choices: FILTERS,
            width: "10rem",
            onChange: (value) => {
              this.#filter = value as Filter;
              this.#renderGrid();
            },
          }),
        ),
        grid,
      ),
    );
    this.#renderGrid();
  }

  #installSection(): HTMLElement {
    const link = h("input", {
      className: "t3mode-search-input",
      attrs: {
        id: "t3mode-plugin-link",
        type: "text",
        placeholder: "owner/repo, or the plugin's GitHub link",
        "aria-label": "Plugin's GitHub link",
        autocomplete: "off",
        spellcheck: "false",
      },
      props: { value: this.#link },
      on: {
        input: (event) => {
          this.#link = (event.target as HTMLInputElement).value;
          if (this.#step.kind === "failed") this.#setStep({ kind: "idle" });
        },
        keydown: (event) => {
          if ((event as KeyboardEvent).key === "Enter") void this.#preview();
        },
      },
    });
    const box = h("div", { className: "t3mode-install" });
    this.#installBox = box;
    const install = button({
      text: "Install",
      icon: "download",
      variant: "outline",
      onClick: () => void this.#preview(),
    });
    install.id = "t3mode-plugin-install";
    const result = section(
      "Install from GitHub",
      null,
      h(
        "div",
        { className: "t3mode-toolbar" },
        h("label", { className: `${native.selectTrigger} t3mode-search` }, link),
        install,
      ),
      box,
    );
    this.#renderInstallStep();
    return result;
  }

  #setStep(step: InstallStep): void {
    this.#step = step;
    this.#renderInstallStep();
  }

  #renderInstallStep(): void {
    const box = this.#installBox;
    if (!box) return;
    const step = this.#step;
    switch (step.kind) {
      case "idle":
        box.replaceChildren();
        return;
      case "reading":
        box.replaceChildren(
          h("p", {
            className: `${native.rowDescription} t3mode-empty`,
            text: "Reading the release…",
          }),
        );
        return;
      case "failed":
        box.replaceChildren(
          h("p", { className: "t3mode-install-error", attrs: { role: "alert" }, text: step.error }),
        );
        return;
      case "confirm":
      case "installing":
        box.replaceChildren(this.#confirmPanel(step));
    }
  }

  #confirmPanel(step: Extract<InstallStep, { kind: "confirm" | "installing" }>): HTMLElement {
    const { preview, installed } = step;
    const installing = step.kind === "installing";
    let firstReady = true;
    let singleConfirm: HTMLButtonElement | null = null;
    const offers = preview.offers.map((offer) => {
      if (offer.kind === "unavailable") {
        return h(
          "div",
          {},
          h("h3", { className: native.rowTitle, text: offer.id }),
          h("p", { className: "t3mode-install-error", text: offer.reason }),
        );
      }
      const { manifest, source } = offer;
      const done = installed.includes(manifest.id);
      const confirm = button({
        text: done
          ? "Installed"
          : installing && step.id === manifest.id
            ? "Installing…"
            : "Install",
        icon: "download",
        variant: "outline",
        onClick: () => void this.#install(preview, offer, installed),
      });
      if (firstReady) confirm.id = "t3mode-plugin-confirm";
      firstReady = false;
      confirm.disabled = installing || done;
      if (preview.offers.length === 1) singleConfirm = confirm;
      const by = manifest.author ? `by ${manifest.author} · ` : "";
      return h(
        "div",
        { attrs: { "aria-label": `Install ${manifest.name}` } },
        h("h3", { className: native.rowTitle, text: `${manifest.name} ${manifest.version}` }),
        h("p", {
          className: native.rowDescription,
          text: `${by}github.com/${sourceLabel(source)}`,
        }),
        ...accessLines(declaredAccess(manifest)).map((text) =>
          h("p", { className: native.rowDescription, text }),
        ),
        manifest.description
          ? h("p", { className: native.rowDescription, text: manifest.description })
          : null,
        preview.offers.length > 1 ? confirm : null,
      );
    });
    const allInstalled = preview.offers.every(
      (offer) => offer.kind === "unavailable" || installed.includes(offer.manifest.id),
    );
    const cancel = button({
      text: allInstalled ? "Done" : "Cancel",
      onClick: () => this.#setStep({ kind: "idle" }),
    });
    cancel.disabled = installing;
    return h(
      "div",
      { className: `${native.card} t3mode-confirm` },
      ...offers,
      h(
        "p",
        { className: "t3mode-warning" },
        icon("warning"),
        h("span", {
          text: "A plugin gets full access to T3 Code, including your threads. Install it only if you trust its author.",
        }),
      ),
      h("div", { className: "t3mode-actions" }, singleConfirm, cancel),
    );
  }

  async #preview(): Promise<void> {
    const input = this.#link.trim();
    if (input === "" || this.#step.kind === "reading" || this.#step.kind === "installing") return;
    this.#setStep({ kind: "reading" });
    const result = await this.#runtime.preview(input);
    this.#setStep(
      result.ok
        ? { kind: "confirm", preview: result.value, installed: [] }
        : { kind: "failed", error: result.error },
    );
    if (result.ok) document.getElementById("t3mode-plugin-confirm")?.focus();
  }

  async #install(
    preview: PluginPreview,
    offer: Extract<PluginOffer, { kind: "ready" }>,
    installed: ReadonlyArray<string>,
  ): Promise<void> {
    this.#setStep({ kind: "installing", preview, installed, id: offer.manifest.id });
    const result = await this.#runtime.install(
      offer.source,
      offer.manifest.id,
      declaredAccess(offer.manifest),
    );
    if (!result.ok) {
      if (preview.offers.length === 1) {
        this.#setStep({ kind: "failed", error: result.error });
        return;
      }
      this.#setStep({ kind: "confirm", preview, installed });
      toast(result.error, "error");
      return;
    }
    if (preview.offers.length > 1) {
      this.#setStep({ kind: "confirm", preview, installed: [...installed, offer.manifest.id] });
      toast(`${result.value.name} ${result.value.version} is installed.`, "info");
      return;
    }
    this.#link = "";
    const link = document.getElementById("t3mode-plugin-link") as HTMLInputElement | null;
    if (link) link.value = "";
    this.#setStep({ kind: "idle" });
    toast(`${result.value.name} ${result.value.version} is installed.`, "info");
  }

  async #checkUpdates(): Promise<void> {
    const result = await this.#runtime.checkUpdates();
    if (!result.ok) {
      toast(`Some plugins could not be checked. ${result.error}`, "error");
      return;
    }
    const updates = result.value.filter((plugin) => plugin.update !== undefined).length;
    toast(
      updates > 0 ? `${plural(updates, "update")} available.` : "All plugins are up to date.",
      "info",
    );
  }

  async #update(plugin: InstalledPlugin): Promise<void> {
    const result = await this.#runtime.updatePlugin(plugin.id);
    if (!result.ok && result.approval) {
      const approval = result.approval;
      const panel = h(
        "div",
        { className: `${native.card} t3mode-confirm` },
        h("h3", { className: native.rowTitle, text: `Approve update for ${plugin.name}` }),
        ...accessLines(result.approval).map((text) =>
          h("p", { className: native.rowDescription, text }),
        ),
        h(
          "div",
          { className: "t3mode-actions" },
          button({
            text: "Approve and update",
            onClick: () =>
              void busy(approve, async () => {
                const updated = await this.#runtime.updatePlugin(plugin.id, approval);
                toast(
                  updated.ok
                    ? `${updated.value.name} is updated to ${updated.value.version}.`
                    : updated.error,
                  updated.ok ? "info" : "error",
                );
                panel.remove();
              }),
          }),
          button({ text: "Cancel", onClick: () => panel.remove() }),
        ),
      );
      const approve = panel.querySelector("button")!;
      this.#body?.querySelector("[data-t3mode-approval]")?.remove();
      panel.setAttribute("data-t3mode-approval", plugin.id);
      this.#body?.prepend(panel);
      panel.scrollIntoView({ block: "nearest" });
      return;
    }
    toast(
      result.ok ? `${result.value.name} is updated to ${result.value.version}.` : result.error,
      result.ok ? "info" : "error",
    );
  }

  async #remove(plugin: InstalledPlugin): Promise<void> {
    const result = await this.#runtime.remove(plugin.id);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(`${plugin.name} is removed.`, "info");
    if (this.#view.kind === "plugin") this.#go({ kind: "plugins" });
  }

  #updateButton(plugin: InstalledPlugin): HTMLButtonElement | null {
    if (plugin.update === undefined) return null;
    const control = button({
      text: `Update to ${plugin.update}`,
      icon: "download",
      variant: "outline",
      onClick: () => void busy(control, () => this.#update(plugin)),
    });
    control.id = `t3mode-${plugin.id}-update`;
    return control;
  }

  #removeButton(plugin: InstalledPlugin): HTMLButtonElement {
    const control = button({
      text: "Remove",
      icon: "trash",
      variant: "outline",
      onClick: () => void busy(control, () => this.#remove(plugin)),
    });
    control.id = `t3mode-${plugin.id}-remove`;
    return control;
  }

  #retryButton(plugin: InstalledPlugin, variant: "ghost" | "outline"): HTMLButtonElement | null {
    if (!canRetry(this.#runtime, plugin)) return null;
    return button({
      text: "Retry",
      icon: "retry",
      variant,
      onClick: () => void this.#runtime.retry(plugin.id),
    });
  }

  #renderGrid(): void {
    const grid = this.#grid;
    if (!grid?.isConnected) return;
    const runtime = this.#runtime;
    const query = this.#query.trim().toLowerCase();
    const shown = runtime.plugins.filter((plugin) => {
      const on = runtime.isEnabled(plugin.id);
      if (this.#filter === "enabled" && !on) return false;
      if (this.#filter === "disabled" && on) return false;
      return (
        query === "" ||
        plugin.name.toLowerCase().includes(query) ||
        plugin.description.toLowerCase().includes(query) ||
        plugin.id.includes(query)
      );
    });
    const count = this.#body?.querySelector(".t3mode-count");
    if (count) {
      const enabled = runtime.plugins.filter((plugin) => runtime.isEnabled(plugin.id)).length;
      count.textContent = `${enabled} of ${runtime.plugins.length} enabled`;
    }
    const focusedId = document.activeElement?.id;
    grid.replaceChildren(
      ...(shown.length > 0
        ? shown.map((plugin) => this.#card(plugin))
        : [
            h("p", {
              className: `${native.rowDescription} t3mode-empty`,
              text: query
                ? `No plugin matches "${this.#query.trim()}".`
                : runtime.plugins.length === 0
                  ? "No plugins installed yet. Paste a plugin's GitHub link above to install it."
                  : "No plugins here.",
            }),
          ]),
    );
    if (focusedId) document.getElementById(focusedId)?.focus();
  }

  #card(plugin: InstalledPlugin): HTMLElement {
    const runtime = this.#runtime;
    const details = () => this.#go({ kind: "plugin", id: plugin.id });
    const toggle = switchControl({
      label: `Enable ${plugin.name}`,
      checked: runtime.isEnabled(plugin.id),
      onChange: (checked) => void runtime.setEnabled(plugin.id, checked),
    });
    toggle.id = `t3mode-${plugin.id}-switch`;
    const settings = iconButton({
      label: `${plugin.name} settings`,
      icon: "settings",
      onClick: details,
    });
    settings.id = `t3mode-${plugin.id}-details`;
    return h(
      "article",
      {
        className: `${native.card} t3mode-card`,
        attrs: { "data-plugin": plugin.id, "aria-label": plugin.name },
        on: {
          click: (event) => {
            if (!(event.target as Element).closest("button, [role=switch]")) details();
          },
        },
      },
      h(
        "div",
        { className: "t3mode-card-head" },
        h("h3", { className: `${native.rowTitle} t3mode-card-title`, text: plugin.name }),
        settings,
        toggle,
      ),
      h("p", {
        className: "t3mode-card-meta",
        text: `${plugin.version} · ${sourceLabel(plugin.source)}`,
      }),
      h("p", {
        className: `${native.rowDescription} t3mode-card-description`,
        text: plugin.description,
      }),
      h(
        "div",
        { className: "t3mode-card-foot" },
        statusLine(runtime, plugin),
        this.#updateButton(plugin),
        this.#retryButton(plugin, "ghost"),
        plugin.error === undefined ? null : this.#removeButton(plugin),
      ),
    );
  }

  #renderPlugin(body: HTMLElement, plugin: InstalledPlugin): void {
    const runtime = this.#runtime;
    const enabled = runtime.isEnabled(plugin.id);
    const values = runtime.options(plugin.id);
    const toggle = switchControl({
      label: `Enable ${plugin.name}`,
      checked: enabled,
      onChange: (checked) => void runtime.setEnabled(plugin.id, checked),
    });
    toggle.id = `t3mode-${plugin.id}-enabled`;
    toggle.setAttribute("data-t3mode-focus", "");

    const optionRows = Object.entries(runtime.optionSpec(plugin.id)).map(([key, option]) => {
      const label = option.label;
      const control =
        option.type === "boolean"
          ? switchControl({
              label,
              checked: values[key] === true,
              onChange: (checked) => void runtime.setOption(plugin.id, key, checked),
            })
          : selectControl({
              host: this.#root ?? body,
              label,
              value: String(values[key]),
              choices: option.choices,
              onChange: (value) => void runtime.setOption(plugin.id, key, value),
            });
      control.id = `t3mode-${plugin.id}-option-${key}`;
      return row({
        title: label,
        ...(option.description ? { description: option.description } : {}),
        control,
      });
    });

    body.append(
      section(
        plugin.name,
        null,
        group(
          ...(plugin.sockets
            ? [row({ description: `Can connect to local sockets: ${plugin.sockets.join(", ")}` })]
            : []),
          row({ title: "Enabled", description: plugin.description, control: toggle }),
          row({
            title: "Status",
            description: statusLine(runtime, plugin),
            control: this.#retryButton(plugin, "outline"),
          }),
          row({
            title: "Source",
            description: this.#sourceText(plugin),
            control: fragment(this.#updateButton(plugin), this.#removeButton(plugin)),
          }),
        ),
      ),
      optionRows.length > 0
        ? section(
            "Options",
            enabled
              ? null
              : h("span", { className: "t3mode-count", text: "Applied when the plugin is on" }),
            group(...optionRows),
          )
        : section(
            "Options",
            null,
            h("p", {
              className: `${native.rowDescription} t3mode-empty`,
              text: runtime.optionsKnown(plugin.id)
                ? "This plugin has no options."
                : "Its options show once the plugin is on. T3 Mode runs none of a plugin's code while it is off.",
            }),
          ),
    );
    const panel = runtime.panel(plugin.id);
    if (panel) {
      const host = h("div");
      body.append(section(panel.title, null, host));
      panel.render(host);
    }
  }

  #sourceText(plugin: InstalledPlugin): string {
    const where =
      plugin.source.kind === "github"
        ? `github.com/${sourceLabel(plugin.source)}`
        : `Linked from ${plugin.source.path}, read again on every reload`;
    const by = plugin.author ? ` by ${plugin.author}` : "";
    const hash = plugin.sha256 ? ` · SHA-256 ${plugin.sha256.slice(0, 12)}` : "";
    return `${where} · version ${plugin.version}${by}${hash}`;
  }
}
