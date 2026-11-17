import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beat, video } from "./timeline.js";

const file = resolve(process.argv[2] ?? "out/spike.mp4");
const raw = (args) =>
  execFileSync("ffmpeg", ["-v", "error", "-i", file, ...args, "-"], { maxBuffer: 1 << 30 });

const pixels = raw(["-vf", "scale=1:1:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24"]);
const frames = pixels.length / 3;
const flashes = [];
let stale = 0;
for (let index = 0; index < frames; index++) {
  const [red, green, blue] = pixels.subarray(index * 3, index * 3 + 3);
  if (red > 230 && green > 230 && blue > 230) flashes.push(index);
  else if (Math.abs(red - ((index * 37) % 200)) > 8) stale++;
}
const flashStarts = flashes.filter((index, position) => flashes[position - 1] !== index - 1);

const samples = new Int16Array(raw(["-ac", "1", "-ar", "48000", "-f", "s16le"]).buffer.slice(0));
const clicks = [];
let quietUntil = 0;
for (let index = 0; index < samples.length; index++) {
  if (index >= quietUntil && Math.abs(samples[index]) > 8000) {
    clicks.push(index / 48000);
    quietUntil = index + 48000 * beat * 0.5;
  }
}

const offsets = flashStarts.map((frame, position) => (clicks[position] - frame / video.fps) * 1000);
console.log(
  JSON.stringify({ frames, stale, flashStarts: flashStarts.length, clicks: clicks.length }),
);
console.log("click minus flash, ms:", offsets.map((value) => value.toFixed(1)).join(" "));
