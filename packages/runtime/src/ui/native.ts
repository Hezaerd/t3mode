// T3 Code's own settings components, rebuilt from its markup so t3mode's page looks native.
// The class strings are copied from T3 Code 0.1.10-nightly.20261114.4669. Its stylesheet only
// contains the Tailwind classes T3 Code itself uses, so t3mode reuses whole class strings from
// live components and never invents Tailwind classes; its own layout lives in styles.ts.
import { h } from "../dom.ts";
import { icon, type IconName } from "./icons.ts";

export const native = {
  header: "flex h-12 shrink-0 items-center gap-3 border-b ps-5 pe-2",
  breadcrumb: "m-0 flex min-w-0 list-none items-center gap-2 p-0 text-sm sm:gap-3",
  crumb: "flex min-w-0 items-center font-medium shrink-0 text-muted-foreground",
  crumbSeparator: "flex shrink-0 items-center text-icon-muted",
  crumbCurrent: "flex min-w-0 items-center font-medium text-foreground truncate",
  headerActions: "ms-auto flex shrink-0 items-center gap-1",
  pageScroll: "topbar-scroll-fade scrollbar-gutter-both flex-1 overflow-y-auto",
  pageBody: "mx-auto flex w-full flex-col px-5 pt-6 pb-12 sm:px-6 max-w-4xl gap-8",
  section: "space-y-2.5",
  sectionHeader: "flex min-h-7 items-start justify-between gap-4 px-3 sm:px-4",
  sectionTitleWrap: "flex min-w-0 items-center gap-1",
  sectionTitle: "flex min-h-7 items-center gap-2 text-base font-semibold text-foreground",
  sectionActions: "flex min-h-7 min-w-7 items-center justify-end",
  group:
    "relative overflow-visible text-foreground rounded-xl border border-border/60 bg-card/40 shadow-xs/5 [&>*+*]:border-t [&>*+*]:border-border/50 [&>[data-slot=settings-row]]:rounded-none",
  /** A settings group's surface without the dividers between its rows. */
  card: "relative overflow-visible text-foreground rounded-xl border border-border/60 bg-card/40 shadow-xs/5",
  row: "group/settings-row @container/settings-row rounded-xl px-3 sm:px-4 aria-disabled:opacity-64 aria-disabled:[&_*]:text-muted-foreground py-3",
  rowLayout:
    "flex flex-col gap-3 @min-[32rem]/settings-row:grid @min-[32rem]/settings-row:grid-cols-[minmax(0,1fr)_auto] @min-[32rem]/settings-row:items-center @min-[32rem]/settings-row:gap-8",
  rowText: "min-w-0 flex-1 space-y-1",
  rowTitleLine: "flex min-h-5 items-center gap-1.5",
  rowTitle: "text-sm font-medium text-foreground",
  rowDescription: "max-w-2xl text-pretty text-xs leading-normal text-muted-foreground",
  rowControl:
    "flex w-full min-w-0 shrink-0 items-center gap-2 @min-[32rem]/settings-row:w-auto @min-[32rem]/settings-row:justify-end @min-[32rem]/settings-row:[&_[data-slot=select-trigger]]:min-w-40",
  switch:
    "inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 cursor-pointer items-center rounded-full p-[2px] outline-none transition-[background-color,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:bg-primary data-unchecked:bg-input data-disabled:cursor-not-allowed data-disabled:opacity-64 data-[mixed]:bg-input [--thumb-size:--spacing(5)] sm:[--thumb-size:--spacing(4)]",
  switchThumb:
    "pointer-events-none block size-[calc(var(--thumb-size)-2px)] shrink-0 origin-left in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:not-data-disabled:scale-x-110 in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.1)] rounded-(--thumb-size) bg-background shadow-sm/5 dark:data-unchecked:bg-muted-foreground [transition:translate_.15s,border-radius_.15s,scale_.1s_.1s,transform-origin_.15s] data-checked:origin-right data-checked:translate-x-[calc(var(--thumb-size)-4px)]",
  selectTrigger:
    "relative inline-flex cursor-pointer select-none items-center justify-between border rounded-lg text-left text-base outline-none transition-[color,box-shadow,background-color] data-disabled:pointer-events-none data-disabled:opacity-64 sm:text-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 min-w-36 border-input bg-background not-dark:bg-clip-padding text-foreground shadow-xs/5 ring-ring/24 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] not-data-disabled:not-focus-visible:not-aria-invalid:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-inset aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/16 dark:bg-input/32 dark:aria-invalid:ring-destructive/24 dark:not-data-disabled:not-focus-visible:not-aria-invalid:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='text-'])]:text-icon-muted [[data-disabled],:focus-visible,[aria-invalid],[data-pressed]]:shadow-none min-h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:min-h-7 w-full sm:w-56",
  selectValue: "flex-1 truncate data-placeholder:text-placeholder",
  selectPopup: "origin-(--transform-origin) rounded-lg text-foreground outline-none",
  selectSurface:
    "dropdown-glass relative h-full rounded-lg shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)] min-w-(--anchor-width)",
  selectList: "max-h-(--available-height) overflow-y-auto p-1 base-ui-disable-scrollbar",
  selectItem:
    "flex min-h-8 cursor-pointer items-center rounded-sm px-2 py-1 text-base outline-none data-selected:bg-foreground/[0.08] data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  selectItemText: "min-w-0 flex-1 [&_svg:not([class*='text-'])]:text-muted-foreground",
  /** The header's "Restore device defaults" button. */
  ghostButton:
    "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-[var(--control-radius)] border font-medium outline-none transition-[box-shadow,scale] [&:not([aria-haspopup]):not(:disabled):not([aria-disabled=true])]:will-change-[scale] [&:active:not([aria-haspopup])]:scale-[0.97] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--control-radius)-1px)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 aria-disabled:cursor-not-allowed aria-disabled:opacity-64 [&_svg:not([class*='text-'])]:text-[var(--control-icon-color)] [&_svg]:pointer-events-none [&_svg]:shrink-0 h-7 gap-1 px-[calc(--spacing(2)-1px)] text-sm sm:h-6 sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5 [--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent",
  /** The header's close button. */
  iconButton:
    "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[var(--control-radius)] border font-medium text-base outline-none transition-[box-shadow,scale] [&:not([aria-haspopup]):not(:disabled):not([aria-disabled=true])]:will-change-[scale] [&:active:not([aria-haspopup])]:scale-[0.97] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--control-radius)-1px)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 aria-disabled:cursor-not-allowed aria-disabled:opacity-64 sm:text-sm [&_svg:not([class*='text-'])]:text-[var(--control-icon-color)] [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 size-8 sm:size-7 [--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent",
} as const;

/** The outlined variant: the ghost button with the select trigger's border and fill. */
const outlineButton = native.ghostButton.replace(
  "border-transparent",
  "border-input bg-background dark:bg-input/32 shadow-xs/5",
);

let nextId = 0;
export const uniqueId = (prefix: string) => `t3mode-${prefix}-${++nextId}`;

export const section = (
  title: string,
  actions: Node | null,
  ...content: ReadonlyArray<Node>
): HTMLElement =>
  h(
    "section",
    { className: native.section },
    h(
      "div",
      { className: native.sectionHeader },
      h(
        "div",
        { className: native.sectionTitleWrap },
        h("h2", { className: native.sectionTitle, text: title }),
      ),
      h("div", { className: native.sectionActions }, actions),
    ),
    ...content,
  );

export const group = (...rows: ReadonlyArray<Node>): HTMLElement =>
  h("div", { className: native.group, attrs: { "data-slot": "settings-group" } }, ...rows);

export const row = (options: {
  readonly title?: string;
  readonly description?: string | Node;
  readonly control?: Node | null;
  readonly disabled?: boolean;
}): HTMLElement =>
  h(
    "div",
    {
      className: native.row,
      attrs: {
        "data-slot": "settings-row",
        ...(options.disabled ? { "aria-disabled": "true" } : {}),
      },
    },
    h(
      "div",
      { className: native.rowLayout },
      h(
        "div",
        { className: native.rowText },
        options.title === undefined
          ? null
          : h(
              "div",
              { className: native.rowTitleLine },
              h("h3", { className: native.rowTitle, text: options.title }),
            ),
        options.description === undefined
          ? null
          : typeof options.description === "string"
            ? h("p", { className: native.rowDescription, text: options.description })
            : h("div", { className: native.rowDescription }, options.description),
      ),
      h("div", { className: native.rowControl }, options.control ?? null),
    ),
  );

const setChecked = (element: Element, checked: boolean) => {
  element.toggleAttribute("data-checked", checked);
  element.toggleAttribute("data-unchecked", !checked);
};

/** T3 Code's switch: a `role="switch"` span with a thumb, toggled by click, Space or Enter. */
export const switchControl = (options: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): HTMLElement => {
  const thumb = h("span", {
    className: native.switchThumb,
    attrs: { "data-slot": "switch-thumb" },
  });
  const control = h(
    "span",
    {
      className: native.switch,
      attrs: {
        role: "switch",
        tabindex: "0",
        "aria-label": options.label,
        "data-size": "default",
        "data-slot": "switch",
      },
    },
    thumb,
  );
  let checked = options.checked;
  const apply = () => {
    control.setAttribute("aria-checked", String(checked));
    setChecked(control, checked);
    setChecked(thumb, checked);
  };
  const toggle = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    checked = !checked;
    apply();
    options.onChange(checked);
  };
  control.addEventListener("click", toggle);
  control.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") toggle(event);
  });
  apply();
  return control;
};

export const button = (options: {
  readonly text: string;
  readonly icon?: IconName;
  readonly variant?: "ghost" | "outline" | "primary";
  readonly onClick: () => void;
}): HTMLButtonElement =>
  h(
    "button",
    {
      className:
        options.variant === "outline"
          ? outlineButton
          : options.variant === "primary"
            ? `${native.ghostButton} t3mode-primary`
            : native.ghostButton,
      attrs: { type: "button", "data-slot": "button" },
      on: { click: options.onClick },
    },
    options.icon ? icon(options.icon) : null,
    h("span", { text: options.text }),
  );

export const iconButton = (options: {
  readonly label: string;
  readonly icon: IconName;
  readonly onClick: () => void;
}): HTMLButtonElement =>
  h(
    "button",
    {
      className: native.iconButton,
      title: options.label,
      attrs: { type: "button", "aria-label": options.label },
      on: {
        click: (event) => {
          event.stopPropagation();
          options.onClick();
        },
      },
    },
    icon(options.icon),
  );

export interface Choice {
  readonly value: string;
  readonly label: string;
}

/**
 * T3 Code's select: the trigger and popup markup of its base-ui select. The popup opens inside
 * `host` instead of document.body, because T3 Code's settings dialog closes on any press
 * outside itself.
 */
export const selectControl = (options: {
  readonly host: HTMLElement;
  readonly label: string;
  readonly value: string;
  readonly choices: ReadonlyArray<Choice>;
  readonly width?: string;
  readonly onChange: (value: string) => void;
}): HTMLButtonElement => {
  let value = options.value;
  const labelOf = (v: string) => options.choices.find((choice) => choice.value === v)?.label ?? v;
  const valueText = h("span", {
    className: native.selectValue,
    attrs: { "data-slot": "select-value" },
    text: labelOf(value),
  });
  const trigger = h(
    "button",
    {
      className: native.selectTrigger,
      attrs: {
        type: "button",
        role: "combobox",
        "aria-haspopup": "listbox",
        "aria-expanded": "false",
        "aria-label": options.label,
        "data-slot": "select-trigger",
      },
      ...(options.width ? { style: { width: options.width } } : {}),
    },
    valueText,
    h(
      "span",
      { attrs: { "aria-hidden": "true", "data-slot": "select-icon" } },
      icon("chevronDown", "-me-1 size-3.5 opacity-70"),
    ),
  );

  let close: (() => void) | null = null;

  const open = () => {
    const listId = uniqueId("list");
    const items = options.choices.map((choice) =>
      h(
        "div",
        {
          className: native.selectItem,
          attrs: {
            role: "option",
            "data-slot": "select-item",
            "data-value": choice.value,
            "aria-selected": String(choice.value === value),
            ...(choice.value === value ? { "data-selected": "" } : {}),
          },
        },
        h("div", { className: native.selectItemText, text: choice.label }),
      ),
    );
    const list = h(
      "div",
      {
        className: native.selectList,
        attrs: { id: listId, role: "listbox", tabindex: "-1", "data-slot": "select-list" },
      },
      ...items,
    );
    const popup = h(
      "div",
      { className: "t3mode-select-positioner", attrs: { "data-slot": "select-positioner" } },
      h(
        "div",
        { className: native.selectPopup, attrs: { "data-slot": "select-popup", "data-open": "" } },
        h("div", { className: native.selectSurface }, list),
      ),
    );

    let highlighted = Math.max(
      0,
      options.choices.findIndex((choice) => choice.value === value),
    );
    const highlight = (index: number) => {
      highlighted = (index + items.length) % items.length;
      items.forEach((item, i) => item.toggleAttribute("data-highlighted", i === highlighted));
      items[highlighted]?.scrollIntoView({ block: "nearest" });
    };
    const choose = (index: number) => {
      const choice = options.choices[index];
      close?.();
      trigger.focus();
      if (!choice || choice.value === value) return;
      value = choice.value;
      valueText.textContent = choice.label;
      options.onChange(choice.value);
    };
    items.forEach((item, index) => {
      item.addEventListener("mouseenter", () => highlight(index));
      item.addEventListener("click", () => choose(index));
    });

    // Above everything else in the page; flips up when the space below is too short.
    const host = options.host.getBoundingClientRect();
    const anchor = trigger.getBoundingClientRect();
    popup.style.setProperty("--anchor-width", `${anchor.width}px`);
    options.host.append(popup);
    const below = host.bottom - anchor.bottom - 12;
    const above = anchor.top - host.top - 12;
    const height = popup.offsetHeight;
    const up = height > below && above > below;
    popup.style.setProperty("--available-height", `${Math.max(120, up ? above : below)}px`);
    popup.style.right = `${host.right - anchor.right}px`;
    if (up) popup.style.bottom = `${host.bottom - anchor.top + 4}px`;
    else popup.style.top = `${anchor.bottom - host.top + 4}px`;
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", listId);
    trigger.toggleAttribute("data-popup-open", true);
    highlight(highlighted);
    list.focus();

    const onKey = (event: KeyboardEvent) => {
      const handled = ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape", "Tab"];
      if (!handled.includes(event.key)) return;
      // Keeps Escape from closing T3 Code's settings dialog too.
      event.stopImmediatePropagation();
      if (event.key !== "Tab") event.preventDefault();
      if (event.key === "ArrowDown") highlight(highlighted + 1);
      else if (event.key === "ArrowUp") highlight(highlighted - 1);
      else if (event.key === "Home") highlight(0);
      else if (event.key === "End") highlight(items.length - 1);
      else if (event.key === "Enter" || event.key === " ") choose(highlighted);
      else {
        close?.();
        if (event.key === "Escape") trigger.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popup.contains(target) && !trigger.contains(target)) close?.();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    close = () => {
      close = null;
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      popup.remove();
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("data-popup-open");
    };
  };

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if (close) close();
    else open();
  });
  trigger.addEventListener("keydown", (event) => {
    if (!close && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      open();
    }
  });
  // A re-render drops the trigger; its popup goes with it.
  new MutationObserver((_, observer) => {
    if (!trigger.isConnected) {
      close?.();
      observer.disconnect();
    }
  }).observe(options.host, { childList: true, subtree: true });
  return trigger;
};
