import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { cues, video } from "./timeline.js";

const file = resolve(process.argv[2] ?? "out/t3mode-trailer.mp4");
const side = 135;
const raw = (args) =>
  execFileSync("ffmpeg", ["-v", "error", "-i", file, ...args, "-"], { maxBuffer: 1 << 30 });

const gray = raw(["-vf", `scale=${side}:${side}:flags=area`, "-f", "rawvideo", "-pix_fmt", "gray"]);
const size = side * side;
const frames = gray.length / size;
const change = [0];
for (let frame = 1; frame < frames; frame++) {
  let sum = 0;
  for (let pixel = 0; pixel < size; pixel++)
    sum += Math.abs(gray[frame * size + pixel] - gray[(frame - 1) * size + pixel]);
  change.push(sum / size);
}

const rate = 48000;
const samples = new Int16Array(
  raw(["-ac", "1", "-ar", String(rate), "-f", "s16le"]).buffer.slice(0),
);
const window = rate / 1000;
const energy = (ms) => {
  let sum = 0;
  const start = Math.round(ms * window);
  for (let index = start; index < start + window && index < samples.length; index++)
    sum += samples[index] ** 2;
  return Math.sqrt(sum / window);
};

const rows = cues
  .filter((cue) => cue.accent && cue.accent !== "stop")
  .map((cue) => {
    const frame = Math.round(cue.time * video.fps);
    const near = [-3, -2, -1, 0, 1, 2, 3].map((offset) => change[frame + offset] ?? 0);
    const firstMove = near.findIndex((value) => value > 0.05) - 3;
    const ms = cue.time * 1000;
    const before = Math.max(energy(ms - 6), energy(ms - 4), energy(ms - 2));
    const after = Math.max(energy(ms), energy(ms + 1), energy(ms + 2));
    return {
      cue: cue.id,
      frame,
      firstMove: firstMove < -3 ? "none" : firstMove,
      audioJump: +(after / Math.max(before, 1)).toFixed(1),
    };
  });
console.table(rows);
console.log(
  `${frames} frames; cues with no visual change within ±3 frames: ${
    rows
      .filter((row) => row.firstMove === "none")
      .map((row) => row.cue)
      .join(", ") || "none"
  }`,
);
