// Lucide icons, the set T3 Code uses, drawn the same way (24px grid, 2px stroke, currentColor).

const SVG_NS = "http://www.w3.org/2000/svg";

type Shape = readonly [tag: "path" | "circle" | "rect", attrs: Readonly<Record<string, string>>];

const path = (d: string): Shape => ["path", { d }];

const ICONS = {
  puzzle: [
    path(
      "M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z",
    ),
  ],
  gear: [
    path(
      "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
    ),
    ["circle", { cx: "12", cy: "12", r: "3" }],
  ],
  settings: [
    path("M14 17H5"),
    path("M19 7h-9"),
    ["circle", { cx: "17", cy: "17", r: "3" }],
    ["circle", { cx: "7", cy: "7", r: "3" }],
  ],
  info: [["circle", { cx: "12", cy: "12", r: "10" }], path("M12 16v-4"), path("M12 8h.01")],
  chevronDown: [path("m6 9 6 6 6-6")],
  check: [path("M20 6 9 17l-5-5")],
  search: [path("m21 21-4.34-4.34"), ["circle", { cx: "11", cy: "11", r: "8" }]],
  x: [path("M18 6 6 18"), path("m6 6 12 12")],
  retry: [path("M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"), path("M3 3v5h5")],
  download: [
    path("M12 15V3"),
    path("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"),
    path("m7 10 5 5 5-5"),
  ],
  trash: [
    path("M3 6h18"),
    path("M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"),
    path("M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"),
  ],
  warning: [
    path("m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"),
    path("M12 9v4"),
    path("M12 17h.01"),
  ],
  folder: [
    path(
      "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
    ),
  ],
} satisfies Record<string, ReadonlyArray<Shape>>;

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName, className = ""): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [key, value] of Object.entries({
    xmlns: SVG_NS,
    width: "24",
    height: "24",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    class: `lucide lucide-${name} ${className}`.trim(),
  })) {
    svg.setAttribute(key, value);
  }
  for (const [tag, attrs] of ICONS[name]) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  return svg;
};
