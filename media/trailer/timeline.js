export const tempo = { bpm: 120, beatsPerBar: 4, offset: 0 };

export const video = { width: 1080, height: 1080, fps: 60, bars: 19 };

export const beat = 60 / tempo.bpm;
export const bar = beat * tempo.beatsPerBar;
export const at = (barIndex, beatIndex = 0) =>
  tempo.offset + (barIndex * tempo.beatsPerBar + beatIndex) * beat;
export const duration = at(video.bars);

export const sections = [
  { id: "hook", bar: 0, bars: 2 },
  { id: "build", bar: 2, bars: 2 },
  { id: "anatomy", bar: 4, bars: 4 },
  { id: "wiring", bar: 8, bars: 4 },
  { id: "payoff", bar: 12, bars: 4 },
  { id: "outro", bar: 16, bars: 3 },
];

export const cues = [
  { id: "ask", bar: 0, beat: 0, accent: null },
  { id: "refuse", bar: 1, beat: 0, accent: "hit" },
  { id: "word-plugins", bar: 2, beat: 0, accent: "tick" },
  { id: "word-now-ship", bar: 2, beat: 2, accent: "tick" },
  { id: "word-a", bar: 3, beat: 0, accent: "tick" },
  { id: "word-backend", bar: 3, beat: 2, accent: "hit" },
  { id: "pre-drop-gap", bar: 3, beat: 3.5, accent: "silence" },
  { id: "drop", bar: 4, beat: 0, accent: "impact" },
  { id: "line-backend", bar: 4, beat: 2, accent: "tick" },
  { id: "line-mcp", bar: 5, beat: 0, accent: "tick" },
  { id: "line-files", bar: 5, beat: 2, accent: "tick" },
  { id: "split", bar: 6, beat: 0, accent: "impact" },
  { id: "node-page", bar: 6, beat: 0.5, accent: "tick" },
  { id: "node-backend", bar: 6, beat: 1, accent: "tick" },
  { id: "node-tools", bar: 6, beat: 1.5, accent: "tick" },
  { id: "own-process", bar: 8, beat: 0, accent: "hit" },
  { id: "wire-claude", bar: 9, beat: 0, accent: "tick" },
  { id: "wire-codex", bar: 9, beat: 2, accent: "tick" },
  { id: "crash", bar: 10, beat: 0, accent: "silence" },
  { id: "restart", bar: 10, beat: 2, accent: "hit" },
  { id: "pin-1", bar: 10, beat: 3, accent: "tick" },
  { id: "pin-2", bar: 10, beat: 3.5, accent: "tick" },
  { id: "pin-3", bar: 11, beat: 0, accent: "tick" },
  { id: "pin-4", bar: 11, beat: 0.5, accent: "tick" },
  { id: "access-prompt", bar: 11, beat: 1, accent: "hit" },
  { id: "payoff", bar: 12, beat: 0, accent: "impact" },
  { id: "tool-screenshot", bar: 12, beat: 2, accent: "tick" },
  { id: "tool-click", bar: 13, beat: 0, accent: "tick" },
  { id: "tool-type", bar: 13, beat: 2, accent: "tick" },
  { id: "done", bar: 14, beat: 0, accent: "hit" },
  { id: "tag-1", bar: 15, beat: 0, accent: "tick" },
  { id: "tag-2", bar: 15, beat: 1, accent: "tick" },
  { id: "tag-3", bar: 15, beat: 2, accent: "tick" },
  { id: "logo", bar: 16, beat: 0, accent: "impact" },
  { id: "install", bar: 16, beat: 2, accent: "tick" },
  { id: "credit", bar: 17, beat: 0, accent: null },
].map((cue) => Object.assign(cue, { time: at(cue.bar, cue.beat) }));

export const cue = (id) => {
  const found = cues.find((entry) => entry.id === id);
  if (!found) throw new Error(`unknown cue ${id}`);
  return found.time;
};
