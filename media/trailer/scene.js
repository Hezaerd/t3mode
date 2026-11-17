import { beat, cue, video } from "./timeline.js";

const color = {
  bg: "#0a0a0b",
  surface: "#141416",
  line: "#26262a",
  ink: "#f2f2f0",
  mute: "#8a8a90",
  accent: "#ff6b2c",
  ok: "#3fb950",
  error: "#e5484d",
};
const alpha = (hex, a) =>
  hex +
  Math.round(a * 255)
    .toString(16)
    .padStart(2, "0");

const F = 1 / video.fps / beat;
const frameOf = (seconds) => Math.round(seconds * video.fps);

const ease = {
  hold: (u) => (u >= 1 ? 1 : 0),
  linear: (u) => u,
  quartIn: (u) => u ** 4,
  quartOut: (u) => 1 - (1 - u) ** 4,
  expoOut: (u) => (u >= 1 ? 1 : 1 - 2 ** (-10 * u)),
  spring: (u) => (u >= 1 ? 1 : 1 - Math.exp(-6.5 * u) * Math.cos(2.4 * Math.PI * u)),
};

// A key's ease shapes the segment that arrives at it; time is a cue plus beats.
const key = (id, beats, values, easing = "expoOut") => ({
  frame: frameOf(cue(id) + beats * beat),
  values,
  easing,
});
const start = (values) => key("ask", 0, values, "hold");

const WINDOW = { x: 96, y: 120, w: 888, h: 840, r: 20 };
const CARD = { x: 200, y: 272, w: 680, h: 536, r: 20 };
const PAGE = { x: 96, y: 96, w: 400, h: 240, r: 18 };
const FRAME = { x: 584, y: 96, w: 400, h: 240 };
const BACKEND = { x: 604, y: 152, w: 360, h: 164, r: 14 };
const TOOLS = { x: 96, y: 426, w: 400, h: 164, r: 14 };
const PILL = { x: 290, y: 584, w: 500, h: 84, r: 42 };
// The diagram sits centered until the lockfile needs the bottom third; DIAGRAM_DROP is that offset.
const DIAGRAM_DROP = 190;
const down = (rect, dy) => ({ ...rect, y: rect.y + dy });
const jsonLine = (index) => ({
  x: CARD.x + 18,
  y: CARD.y + 44 + 56 * index,
  w: CARD.w - 36,
  h: 56,
  r: 8,
});

const copy = {
  ask: "Screenshot the failing build and post it in #release.",
  json: [
    ["{"],
    ["  ", ["k", '"id"'], ": ", ["v", '"computer-use"'], ","],
    ["  ", ["k", '"version"'], ": ", ["v", '"1.0.0"'], ","],
    ["  ", ["k", '"api"'], ": ", ["v", "1"], ","],
    ["  ", ["k", '"backend"'], ": ", ["v", '"backend.js"'], ","],
    ["  ", ["k", '"mcp"'], ": ", ["v", '"tools.js"'], ","],
    ["  ", ["k", '"files"'], ": [", ["v", '"xa11y.node"'], "]"],
    ["}"],
  ],
  build: [
    { top: 270, words: [["Plugins", "word-plugins"]] },
    { top: 450, words: [["now ship", "word-now-ship"]] },
    {
      top: 630,
      words: [
        ["a ", "word-a"],
        ["backend.", "word-backend", true],
      ],
    },
  ],
  tagline: [
    { top: 268, words: [["Your plugin.", "tag-1"]] },
    {
      top: 404,
      words: [
        ["Its own ", "tag-2"],
        ["backend.", "tag-2", true],
      ],
    },
    { top: 540, words: [["Your agent's ", "tag-3"]] },
    { top: 676, words: [["tools.", "tag-3", true]] },
  ],
  tools: [
    ["tool-screenshot", "screenshot"],
    ["tool-click", 'click "#release"'],
    ["tool-type", 'type "Build 482 is failing"'],
  ],
  pins: [
    ["plugin.js", "9f2c41"],
    ["backend.js", "3e8a07"],
    ["tools.js", "c51d9b"],
    ["xa11y.node", "7a04e2"],
  ],
  pill: "npx t3mode install",
};

const $ = (id) => document.getElementById(id);
const make = (tag, parent, props = {}) =>
  Object.assign(parent.appendChild(document.createElement(tag)), props);

const typed = (parent, text) =>
  text.split(" ").map((word, index) => {
    if (index > 0) parent.append(" ");
    return make("span", parent, { textContent: word });
  });
const askWords = typed($("ask"), copy.ask);
const pillWords = typed($("pill"), copy.pill);

const jsonLines = copy.json.map((parts) => {
  const div = make("div", $("json"));
  for (const part of parts)
    if (typeof part === "string") div.append(part);
    else make("span", div, { className: part[0], textContent: part[1] });
  return div;
});

const kinetic = (layer, lines, size) =>
  lines.flatMap(({ top, words }) => {
    const line = make("div", $(layer), { className: "kinetic" });
    Object.assign(line.style, {
      top: `${top}px`,
      fontSize: `${size}px`,
      lineHeight: `${size * 1.2}px`,
    });
    return words.map(([text, id, accent]) => {
      const span = make(accent ? "em" : "span", line, { textContent: text });
      span.style.display = "inline-block";
      return { span, id, height: size * 1.2 };
    });
  });
const buildWords = kinetic("build", copy.build, 150);
const tagWords = kinetic("tagline", copy.tagline, 116);

const check =
  '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M4 13.5 L10.5 20 L22 6.5" pathLength="1" fill="none" stroke="#3fb950" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 1"/></svg>';
for (const [id, action] of copy.tools) {
  $(id).innerHTML = check;
  const text = make("span", $(id));
  make("em", text, { textContent: "computer-use" });
  text.append(` · ${action}`);
}

const pinRows = copy.pins.map(([file, hash], index) => {
  const row = make("div", $("lock"), { className: "pin" });
  row.style.top = `${68 + 56 * index}px`;
  row.append(file);
  make("span", row, { textContent: `sha256 ${hash}…` });
  return row;
});

const impactShake = (id) => [
  key(id, 0, { shake: 12 }, "hold"),
  key(id, 14 * F, { shake: 0 }, "quartOut"),
];
const rise = (id, beats = 0, distance = 14) => [
  key(id, beats, { opacity: 1, ty: distance }, "hold"),
  key(id, beats + 8 * F, { ty: 0 }),
];
const stamp = (id) => [
  key(id, 0, { opacity: 1, scale: 1.07 }, "hold"),
  key(id, 6 * F, { scale: 1 }),
];
const punch = (id) => [key(id, 0, { scale: 1.04 }, "hold"), key(id, 10 * F, { scale: 1 })];

const tracks = [
  {
    el: $("camera"),
    keys: [
      start({ shake: 0 }),
      ...impactShake("drop"),
      ...impactShake("split"),
      ...impactShake("payoff"),
    ],
  },

  {
    el: $("shell"),
    keys: [
      start({ ...WINDOW, opacity: 1, scale: 1, blur: 0, border: color.line }),
      key("word-plugins", 0, { scale: 1, opacity: 1, blur: 0 }, "hold"),
      key("word-plugins", 12 * F, { scale: 0.92, opacity: 0.16, blur: 6 }),
      key("drop", -2 * F, { scale: 0.92 }, "hold"),
      key("drop", 0, { scale: 0.89, opacity: 0.16, blur: 6, ...WINDOW }, "quartIn"),
      key("drop", 10 * F, { ...CARD, scale: 1, opacity: 1, blur: 0 }, "spring"),
      key("split", -2 * F, { ...CARD, scale: 1 }, "hold"),
      key("split", 0, { ...CARD, scale: 0.97 }, "quartOut"),
      key("split", 12 * F, { ...down(PAGE, DIAGRAM_DROP), scale: 1 }, "spring"),
      key("pin-1", 0, down(PAGE, DIAGRAM_DROP), "hold"),
      key("pin-1", 12 * F, PAGE, "quartOut"),
      key("payoff", -2 * F, { ...PAGE, scale: 1 }, "hold"),
      key("payoff", 0, { ...PAGE, scale: 0.96 }, "quartOut"),
      key("payoff", 12 * F, { ...WINDOW, scale: 1 }, "spring"),
      key("tag-1", 0, { scale: 1, opacity: 1, blur: 0 }, "hold"),
      key("tag-1", 12 * F, { scale: 0.92, opacity: 0.16, blur: 6 }),
      key("logo", 0, { ...WINDOW, scale: 0.92, opacity: 0.16, blur: 6 }, "hold"),
      key("logo", 10 * F, { ...PILL, scale: 1, opacity: 1, blur: 0 }),
    ],
  },
  {
    el: $("titlebar"),
    keys: [
      start({ opacity: 1 }),
      key("drop", 0, { opacity: 1 }, "hold"),
      key("drop", 3 * F, { opacity: 0 }, "linear"),
      key("split", 4 * F, { opacity: 0 }, "hold"),
      key("split", 10 * F, { opacity: 1 }, "quartOut"),
      key("logo", 0, { opacity: 0 }, "hold"),
    ],
  },
  {
    el: $("title"),
    keys: [
      start({ opacity: 1, ty: 0 }),
      key("drop", 0, { opacity: 0 }, "hold"),
      ...rise("node-page", 0, 8),
    ],
  },
  {
    el: $("chat"),
    keys: [
      start({ opacity: 1 }),
      key("drop", 0, { opacity: 1 }, "hold"),
      key("drop", 2 * F, { opacity: 0 }, "linear"),
      key("payoff", 4 * F, { opacity: 0 }, "hold"),
      key("payoff", 10 * F, { opacity: 1 }, "quartOut"),
      key("logo", 0, { opacity: 0 }, "hold"),
    ],
  },
  ...askWords.map((span, index) => ({
    el: span,
    // Two words are already up on frame 0 so the muted autoplay frame reads, and the last word lands before refuse.
    keys:
      index < 2
        ? [start({ opacity: 1, ty: 0 })]
        : [start({ opacity: 0, ty: 0 }), ...rise("ask", (index - 1) / 2, 8)],
  })),
  {
    el: $("refuse"),
    keys: [
      start({ opacity: 0, scale: 1 }),
      ...stamp("refuse"),
      key("payoff", 0, { opacity: 0 }, "hold"),
    ],
  },
  ...copy.tools.map(([id]) => ({
    el: $(id),
    keys: [
      start({ opacity: 0, tx: 0 }),
      key(id, 0, { opacity: 1, tx: 20 }, "hold"),
      key(id, 8 * F, { tx: 0 }),
    ],
  })),
  ...copy.tools.map(([id]) => ({
    el: $(id).querySelector("path"),
    keys: [
      start({ draw: 0 }),
      key(id, 0, { draw: 0 }, "hold"),
      key(id, 7 * F, { draw: 1 }, "quartOut"),
    ],
  })),
  { el: $("done"), keys: [start({ opacity: 0, scale: 1 }), ...stamp("done")] },

  {
    el: $("json"),
    keys: [
      start({ opacity: 0 }),
      key("drop", 0, { opacity: 0 }, "hold"),
      key("drop", 3 * F, { opacity: 1 }, "linear"),
      key("split", 0, { opacity: 1 }, "hold"),
      key("split", 3 * F, { opacity: 0 }, "linear"),
    ],
  },
  ...[
    [4, "line-backend"],
    [5, "line-mcp"],
    [6, "line-files"],
  ].map(([index, id]) => ({
    el: jsonLines[index],
    keys: [start({ hl: 0 }), key(id, 0, { hl: 1 }, "hold")],
  })),
  {
    el: $("pagebody"),
    keys: [
      start({ opacity: 0, ty: 0 }),
      ...rise("node-page", 0, 12),
      key("payoff", 0, { opacity: 1 }, "hold"),
      key("payoff", 3 * F, { opacity: 0 }, "linear"),
    ],
  },
  ...pillWords.map((span, index) => ({
    el: span,
    keys: [start({ opacity: 0, ty: 0 }), ...rise("install", index / 2, 8)],
  })),

  {
    el: $("diagram"),
    keys: [
      start({ ty: DIAGRAM_DROP, scale: 1, opacity: 1 }),
      key("pin-1", 0, { ty: DIAGRAM_DROP }, "hold"),
      key("pin-1", 12 * F, { ty: 0 }, "quartOut"),
      key("payoff", -2 * F, { scale: 1, opacity: 1 }, "hold"),
      key("payoff", 0, { scale: 0.97, opacity: 1 }, "quartOut"),
      key("payoff", 8 * F, { scale: 0.5, opacity: 0 }),
    ],
  },
  ...[
    [$("backend"), 4, "line-backend", BACKEND],
    [$("tools"), 5, "line-mcp", TOOLS],
  ].map(([el, index, id, target]) => ({
    el,
    keys: [
      start({
        ...down(jsonLine(index), -DIAGRAM_DROP),
        opacity: 0,
        reveal: 0,
        bg: alpha(color.accent, 0.14),
        border: alpha(color.accent, 0),
      }),
      key(id, 0, { opacity: 1, reveal: 0 }, "hold"),
      key(id, 8 * F, { reveal: 1 }),
      key(
        "split",
        0,
        {
          ...down(jsonLine(index), -DIAGRAM_DROP),
          bg: alpha(color.accent, 0.14),
          border: alpha(color.accent, 0),
        },
        "hold",
      ),
      key("split", 12 * F, { ...target, bg: color.surface, border: color.accent }, "spring"),
    ],
  })),
  {
    el: $("files"),
    keys: [
      start({
        ...down(jsonLine(6), -DIAGRAM_DROP),
        opacity: 0,
        reveal: 0,
        bg: alpha(color.accent, 0.14),
      }),
      key("line-files", 0, { opacity: 1, reveal: 0 }, "hold"),
      key("line-files", 8 * F, { reveal: 1 }),
      key("split", 0, { reveal: 1, opacity: 1 }, "hold"),
      key("split", 6 * F, { reveal: 0, opacity: 0 }, "quartOut"),
    ],
  },
  { el: $("backend-label"), keys: [start({ opacity: 0, ty: 0 }), ...rise("node-backend", 0, 12)] },
  { el: $("tools-label"), keys: [start({ opacity: 0, ty: 0 }), ...rise("node-tools", 0, 12)] },
  {
    el: $("backend"),
    keys: [
      start({ scale: 1, glitch: 0 }),
      ...punch("node-backend"),
      key("crash", 0, { glitch: 1, opacity: 1 }, "hold"),
      key("crash", 8 * F, { glitch: 0, opacity: 1 }, "hold"),
      key("crash", 14 * F, { opacity: 0.3 }, "quartOut"),
      key("restart", 0, { opacity: 1, scale: 0.92 }, "hold"),
      key("restart", 12 * F, { scale: 1 }, "spring"),
    ],
  },
  { el: $("tools"), keys: [start({ scale: 1 }), ...punch("node-tools")] },

  {
    el: $("frame"),
    keys: [
      start({
        ...FRAME,
        opacity: 0,
        scale: 1,
        border: color.mute,
        bg: alpha(color.error, 0),
        tx: 0,
        glitch: 0,
      }),
      key("own-process", 0, { opacity: 1, scale: 1.05 }, "hold"),
      key("own-process", 10 * F, { scale: 1 }),
      key("crash", 0, { border: color.error, bg: alpha(color.error, 0.4), glitch: 1 }, "hold"),
      key("crash", 8 * F, { glitch: 0 }, "hold"),
      key("crash", 12 * F, { bg: alpha(color.error, 0.1) }, "quartOut"),
      key("restart", 0, { border: color.ok, bg: alpha(color.ok, 0.22) }, "hold"),
      key("restart", 12 * F, { bg: alpha(color.ok, 0.06) }, "quartOut"),
    ],
  },
  {
    el: $("crashed"),
    keys: [
      start({ opacity: 0 }),
      key("crash", 0, { opacity: 1 }, "hold"),
      key("restart", 0, { opacity: 0 }, "hold"),
    ],
  },
  { el: $("restarted"), keys: [start({ opacity: 0, ty: 0 }), ...rise("restart", 0, 8)] },
  { el: $("keeps"), keys: [start({ opacity: 0, ty: 0 }), ...rise("crash", 0, 8)] },
  {
    el: $("wire-page"),
    keys: [
      start({ draw: 0, stroke: color.mute }),
      key("own-process", 0, { draw: 0 }, "hold"),
      key("own-process", 10 * F, { draw: 1 }),
    ],
  },
  ...["claude", "codex"].flatMap((name) => [
    {
      el: $(`wire-${name}`),
      keys: [
        start({ draw: 0, stroke: color.accent }),
        key(`wire-${name}`, 0, { draw: 0 }, "hold"),
        key(`wire-${name}`, 10 * F, { draw: 1 }),
      ],
    },
    {
      el: $(`chip-${name}`),
      keys: [
        start({ opacity: 0, scale: 1 }),
        key(`wire-${name}`, 0, { opacity: 1, scale: 0.9 }, "hold"),
        key(`wire-${name}`, 12 * F, { scale: 1 }, "spring"),
      ],
    },
  ]),
  { el: $("lock"), keys: [start({ opacity: 0 }), key("pin-1", 0, { opacity: 1 }, "hold")] },
  ...pinRows.map((row, index) => ({
    el: row,
    keys: [
      start({ opacity: 0, tx: 0 }),
      key(`pin-${index + 1}`, 0, { opacity: 1, tx: -18 }, "hold"),
      key(`pin-${index + 1}`, 7 * F, { tx: 0 }),
    ],
  })),
  {
    el: $("dialog"),
    keys: [
      start({ opacity: 0, scale: 1, ty: 0 }),
      key("access-prompt", 0, { opacity: 1, scale: 0.94, ty: 16 }, "hold"),
      key("access-prompt", 12 * F, { scale: 1, ty: 0 }, "spring"),
    ],
  },

  ...buildWords.map(({ span, id, height }) => ({
    el: span,
    keys: [
      start({ opacity: 0, ty: height, scale: 1 }),
      key(id, -F, { opacity: 1, ty: height }, "hold"),
      key(id, 10 * F, { ty: 0 }),
      key("pre-drop-gap", 0, { opacity: 0 }, "hold"),
    ],
  })),
  {
    el: $("tagline"),
    keys: [
      start({ scale: 1, opacity: 1 }),
      key("logo", -2 * F, { scale: 1, opacity: 1 }, "hold"),
      key("logo", 0, { scale: 0.97 }, "quartOut"),
      key("logo", 0, { opacity: 0 }, "hold"),
    ],
  },
  ...tagWords.map(({ span, id, height }) => ({
    el: span,
    keys: [
      start({ opacity: 0, ty: height }),
      key(id, -F, { opacity: 1, ty: height }, "hold"),
      key(id, 10 * F, { ty: 0 }),
    ],
  })),
  {
    el: $("logo"),
    keys: [
      start({ opacity: 0, scale: 1 }),
      key("logo", 0, { opacity: 1, scale: 1.14 }, "hold"),
      key("logo", 10 * F, { scale: 1 }, "spring"),
    ],
  },
  {
    el: $("credit"),
    keys: [
      start({ opacity: 0, ty: 0 }),
      key("credit", 0, { opacity: 0, ty: 10 }, "hold"),
      key("credit", 20 * F, { opacity: 1, ty: 0 }, "quartOut"),
    ],
  },
];

const parseColor = (hex) => {
  const digits = hex.length === 7 ? `${hex.slice(1)}ff` : hex.slice(1);
  return [0, 2, 4, 6].map((at) => parseInt(digits.slice(at, at + 2), 16));
};
const mix = (from, to, amount) => {
  if (typeof from === "number") return from + (to - from) * amount;
  const [a, b] = [parseColor(from), parseColor(to)];
  amount = Math.min(1, Math.max(0, amount));
  const [r, g, bl, al] = a.map((channel, index) => channel + (b[index] - channel) * amount);
  return `rgba(${r.toFixed(1)},${g.toFixed(1)},${bl.toFixed(1)},${(al / 255).toFixed(3)})`;
};

// Every intended move is short; a long eased segment means a missing hold key, not a slow move.
const LONGEST_MOVE = 24;

const compile = (el, keys) => {
  const props = {};
  for (const { frame, values, easing } of keys)
    for (const [name, value] of Object.entries(values))
      (props[name] ??= []).push({ frame, value, easing });
  for (const [name, list] of Object.entries(props)) {
    list.sort((a, b) => a.frame - b.frame);
    if (list[0].frame !== 0)
      throw new Error(`${el.id || el.textContent} ${name}: no value on frame 0`);
    for (const [index, to] of list.entries()) {
      const from = list[index - 1];
      if (
        from &&
        to.easing !== "hold" &&
        to.frame - from.frame > LONGEST_MOVE &&
        from.value !== to.value
      )
        throw new Error(
          `${el.id || el.textContent} ${name}: ${to.frame - from.frame}-frame eased segment ending at frame ${to.frame}`,
        );
    }
  }
  return { el, props: Object.entries(props) };
};

const sample = (list, frame) => {
  if (frame <= list[0].frame) return mix(list[0].value, list[0].value, 0);
  let index = list.length - 1;
  while (list[index].frame > frame) index--;
  const from = list[index];
  const to = list[index + 1];
  if (!to) return mix(from.value, from.value, 0);
  return mix(from.value, to.value, ease[to.easing]((frame - from.frame) / (to.frame - from.frame)));
};

const glitchOffsets = [16, -11, 7, -18, 10, -6];

const write = (el, v, frame) => {
  const style = el.style;
  if ("x" in v)
    Object.assign(style, {
      left: `${v.x}px`,
      top: `${v.y}px`,
      width: `${v.w}px`,
      height: `${v.h}px`,
    });
  if ("r" in v) style.borderRadius = `${v.r}px`;
  if ("opacity" in v) {
    style.opacity = v.opacity;
    style.visibility = v.opacity <= 0.001 ? "hidden" : "visible";
  }
  if ("blur" in v) style.filter = v.blur > 0.01 ? `blur(${v.blur.toFixed(2)}px)` : "none";
  if ("bg" in v) style.backgroundColor = v.bg;
  if ("border" in v) style.borderColor = v.border;
  if ("stroke" in v) style.stroke = v.stroke;
  if ("draw" in v) style.strokeDashoffset = 1 - v.draw;
  if ("hl" in v) style.setProperty("--hl", v.hl);
  if ("reveal" in v)
    style.clipPath = v.reveal >= 1 ? "none" : `inset(0 ${((1 - v.reveal) * 100).toFixed(2)}% 0 0)`;
  const glitch = v.glitch ?? 0;
  const jitter = glitch > 0 ? glitchOffsets[frame % glitchOffsets.length] * glitch : 0;
  if ("glitch" in v) style.boxShadow = jitter ? `${-jitter}px 0 0 ${color.error}` : "none";
  const shake = v.shake ?? 0;
  const tx = (v.tx ?? 0) + jitter + shake * Math.sin(frame * 2.3);
  const ty = (v.ty ?? 0) + shake * Math.cos(frame * 3.1);
  if (["tx", "ty", "scale", "glitch", "shake"].some((name) => name in v))
    style.transform = `translate(${tx.toFixed(2)}px,${ty.toFixed(2)}px) scale(${v.scale ?? 1})`;
};

const keysByElement = new Map();
for (const { el, keys } of tracks)
  keysByElement.set(el, [...(keysByElement.get(el) ?? []), ...keys]);
const compiled = [...keysByElement].map(([el, keys]) => compile(el, keys));

const seek = (seconds) => {
  const frame = frameOf(seconds);
  for (const { el, props } of compiled) {
    const values = {};
    for (const [name, list] of props) values[name] = sample(list, frame);
    write(el, values, frame);
  }
};

const fonts = [
  new FontFace("Geist", "url(fonts/Geist-Variable.woff2)", { weight: "100 900" }),
  new FontFace("Geist Mono", "url(fonts/GeistMono-Variable.woff2)", { weight: "100 900" }),
];

window.trailer = {
  ready: Promise.all(fonts.map((face) => face.load())).then(() => {
    for (const face of fonts) document.fonts.add(face);
    seek(0);
    return document.fonts.ready;
  }),
  seek,
};
