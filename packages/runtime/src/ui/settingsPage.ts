// T3 Mode's pages inside T3 Code's settings. A "T3 Mode" group in the settings navigation holds
// two entries, like Vencord's: "T3 Mode" (version, shortcut, logs, troubleshooting) and
// "Plugins" (a card grid with search and filter, and a page per plugin for its options). Pages
// open in the settings content pane, built from T3 Code's own components (see native.ts).
//
// The pane is React's. t3mode adds its page as the pane's last child and hides React's
// children with CSS while it is open, so React's nodes are never moved or removed.
import { h } from "../dom.ts";
import type { PluginState, Runtime } from "../Runtime.ts";
import type { Plugin } from "../types.ts";
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

const NAV_ATTRIBUTE = "data-t3mode-nav";
const NAV_GROUP_ATTRIBUTE = "data-t3mode-nav-group";
const NAME = "T3 Mode";
const PAGE_ATTRIBUTE = "data-t3mode-page";
const OPEN_ATTRIBUTE = "data-t3mode-page-open";
const SETTINGS_ROUTE = "#/settings/general";

const sel = {
  pane: '[data-workspace-area="settings"]',
  nav: '[data-workspace-area="settings-nav"]',
  section: "button[data-settings-section]",
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

const status = (runtime: Runtime, plugin: Plugin): { tone: Tone; text: string } => {
  const state: PluginState = runtime.state(plugin.id);
  switch (state.kind) {
    case "off":
      return { tone: "off", text: runtime.isEnabled(plugin) ? "Starting" : "Off" };
    case "failed":
      return { tone: "failed", text: `Stopped after an error: ${state.error.split("\n")[0]}` };
    case "running":
      if (!state.report) return { tone: "active", text: "Running" };
      return {
        tone: state.report.state,
        text: `${state.report.state === "active" ? "Active" : "Waiting"}: ${state.report.detail}`,
      };
  }
};

const statusLine = (runtime: Runtime, plugin: Plugin) => {
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
    entry.removeAttribute("data-settings-section");
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
    const plugin =
      this.#view.kind === "plugin"
        ? this.#runtime.plugins.find((item) => item.id === (this.#view as { id: string }).id)
        : undefined;
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

  #header(plugin: Plugin | undefined): HTMLElement {
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
            description: `To start T3 Code once without ${NAME}, close it and run "pnpm t3mode safe". ${NAME} also skips a launch on its own after failed starts or repeated crashes.`,
          }),
          row({
            title: "Uninstall",
            description: `Close T3 Code and run "pnpm t3mode uninstall" to restore its original files.`,
          }),
        ),
      ),
    );
  }

  #renderPlugins(body: HTMLElement): void {
    const runtime = this.#runtime;
    const enabled = runtime.plugins.filter((plugin) => runtime.isEnabled(plugin)).length;

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

    body.append(
      section(
        "Plugins",
        h("span", {
          className: "t3mode-count",
          text: `${enabled} of ${runtime.plugins.length} enabled`,
        }),
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

  #renderGrid(): void {
    const grid = this.#grid;
    if (!grid?.isConnected) return;
    const runtime = this.#runtime;
    const query = this.#query.trim().toLowerCase();
    const shown = runtime.plugins.filter((plugin) => {
      const on = runtime.isEnabled(plugin);
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
      const enabled = runtime.plugins.filter((plugin) => runtime.isEnabled(plugin)).length;
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
                  ? "No plugins in this build. Add yours to packages/runtime/src/userplugins, then build and deploy."
                  : "No plugins here.",
            }),
          ]),
    );
    if (focusedId) document.getElementById(focusedId)?.focus();
  }

  #card(plugin: Plugin): HTMLElement {
    const runtime = this.#runtime;
    const hasOptions = Object.keys(plugin.options).length > 0;
    const details = () => this.#go({ kind: "plugin", id: plugin.id });
    const toggle = switchControl({
      label: `Enable ${plugin.name}`,
      checked: runtime.isEnabled(plugin),
      onChange: (checked) => void runtime.setEnabled(plugin, checked),
    });
    toggle.id = `t3mode-${plugin.id}-switch`;
    const settings = iconButton({
      label: hasOptions ? `${plugin.name} settings` : `About ${plugin.name}`,
      icon: hasOptions ? "settings" : "info",
      onClick: details,
    });
    settings.id = `t3mode-${plugin.id}-details`;
    const failed = runtime.state(plugin.id).kind === "failed";
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
        className: `${native.rowDescription} t3mode-card-description`,
        text: plugin.description,
      }),
      h(
        "div",
        { className: "t3mode-card-foot" },
        statusLine(runtime, plugin),
        failed
          ? button({ text: "Retry", icon: "retry", onClick: () => runtime.retry(plugin) })
          : null,
      ),
    );
  }

  #renderPlugin(body: HTMLElement, plugin: Plugin): void {
    const runtime = this.#runtime;
    const enabled = runtime.isEnabled(plugin);
    const values = runtime.options(plugin);
    const failed = runtime.state(plugin.id).kind === "failed";
    const toggle = switchControl({
      label: `Enable ${plugin.name}`,
      checked: enabled,
      onChange: (checked) => void runtime.setEnabled(plugin, checked),
    });
    toggle.id = `t3mode-${plugin.id}-enabled`;
    toggle.setAttribute("data-t3mode-focus", "");

    const optionRows = Object.entries(plugin.options).map(([key, option]) => {
      const label = option.label;
      const control =
        option.type === "boolean"
          ? switchControl({
              label,
              checked: values[key] === true,
              onChange: (checked) => void runtime.setOption(plugin, key, checked),
            })
          : selectControl({
              host: this.#root ?? body,
              label,
              value: String(values[key]),
              choices: option.choices,
              onChange: (value) => void runtime.setOption(plugin, key, value),
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
          row({ title: "Enabled", description: plugin.description, control: toggle }),
          row({
            title: "Status",
            description: statusLine(runtime, plugin),
            control: failed
              ? button({
                  text: "Retry",
                  icon: "retry",
                  variant: "outline",
                  onClick: () => runtime.retry(plugin),
                })
              : null,
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
              text: "This plugin has no options.",
            }),
          ),
    );
  }
}
