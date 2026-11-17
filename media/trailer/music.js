import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { at, beat, tempo, duration, sections, cues } from "./timeline.js";
const sectionById = (id) => sections.find((section) => section.id === id);
const outro = sectionById("outro");
const anatomy = sectionById("anatomy");

const rate = 48000;
const count = Math.round(duration * rate);
const out = new URL("./out/", import.meta.url);
const tau = Math.PI * 2;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const cueTime = (cue) => at(cue.bar, cue.beat);
const sample = (time) => Math.round(time * rate);
const stops = cues
  .filter((cue) => cue.accent === "silence")
  .map((cue) => ({
    id: cue.id,
    start: sample(cueTime(cue)),
    end: sample(cueTime(cues[cues.indexOf(cue) + 1])),
  }));

const patterns = {
  kick: [0, 1, 2, 3],
  hat: [0.5, 1.5, 2.5, 3.5],
  clap: [1, 3],
  bass: [0.5, 1.5, 2.5, 3.5],
  arp: [0.75, 1.5, 2.75, 3.5],
  pad: [0],
  tick: Array.from({ length: 16 }, (_, i) => i / 4),
  sweep: [0],
  riser: [0],
  roll: [0, 1, 2, 2.5, 3, 3.25],
  denseRoll: [0, 0.5, 1, 1.5, 2, 2.25, 2.5, 2.75, 3, 3.125, 3.25, 3.375],
  openHat: [1.5, 3.5],
};

const groove = [
  ["kick", "kick", 0.52],
  ["hat", "hat", 0.3],
  ["clap", "clap", 0.3],
  ["bass", "bass", 0.29],
  ["arp", "arp", 0.24],
  ["pad", "pad", 0.085],
];
const registry = {
  hook: [
    ["pad", "pad", 0.14],
    ["tick", "tick", 0.018],
  ],
  build: [
    ["pad", "pad", 0.16],
    ["sweep", "sweep", 0.09, 0],
    ["riser", "riser", 0.08, 0],
    ["clap", "roll", 0.055, 0],
    ["clap", "denseRoll", 0.065, 1],
  ],
  anatomy: groove,
  wiring: groove,
  payoff: [...groove, ["openHat", "openHat", 0.075]],
  outro: [["pad", "pad", 0.18, 0]],
};

function schedule(accentsOnly) {
  const events = [];
  if (!accentsOnly) {
    for (const section of sections) {
      for (let localBar = 0; localBar < section.bars; localBar++) {
        for (const [voice, pattern, level, onlyBar] of registry[section.id]) {
          if (onlyBar !== undefined && onlyBar !== localBar) continue;
          for (const position of patterns[pattern]) {
            const bar = section.bar + localBar;
            events.push({
              voice,
              level,
              time: at(bar, position),
              bar,
              position,
              length: { pad: section.id === "outro" ? 10 : 4, sweep: 8, riser: 8 }[voice] ?? 4,
              note: [45, 45, 48, 43][localBar % 4],
            });
          }
        }
      }
    }
  }
  const accents = { impact: ["impact", 0.85], hit: ["stab", 0.3], tick: ["rim", 0.15] };
  for (const cue of cues) {
    const spec = accents[cue.accent];
    if (spec)
      events.push({
        voice: spec[0],
        level: spec[1],
        time: cueTime(cue),
        bar: cue.bar,
        position: cue.beat,
        note: 57,
        length: 1,
        id: cue.id,
      });
    if (!accentsOnly && cue.id === "crash")
      events.push({
        voice: "glitch",
        level: 0.17,
        time: cueTime(cue),
        bar: cue.bar,
        position: cue.beat,
        length: 0.12,
      });
  }
  return events.toSorted((a, b) => a.time - b.time);
}

function randomSource(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 2147483648 - 1;
  };
}

function blep(phase, step) {
  if (phase < step) {
    const x = phase / step;
    return x + x - x * x - 1;
  }
  if (phase > 1 - step) {
    const x = (phase - 1) / step;
    return x * x + x + x + 1;
  }
  return 0;
}

function lowpass() {
  let ic1 = 0,
    ic2 = 0;
  return (input, cutoff, resonance = 0.8) => {
    const g = Math.tan((Math.PI * clamp(cutoff, 20, 16000)) / rate);
    const a = 1 / (1 + g * (g + resonance));
    const v1 = a * (ic1 + g * (input - ic2));
    const v2 = ic2 + g * v1;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    return v2;
  };
}

const lengths = {
  kick: 0.9,
  hat: 0.19,
  openHat: 0.65,
  clap: 0.4,
  bass: 0.7,
  arp: 0.65,
  tick: 0.08,
  rim: 0.13,
  stab: 0.65,
  impact: 2.9,
  glitch: 0.12,
};
const sends = {
  kick: 0.015,
  hat: 0.1,
  openHat: 0.15,
  clap: 0.35,
  bass: 0,
  arp: 0.4,
  pad: 0.5,
  sweep: 0.3,
  riser: 0.22,
  tick: 0.12,
  rim: 0.14,
  stab: 0.35,
  impact: 0.55,
  glitch: 0,
};

function render(accentsOnly) {
  const dry = [new Float64Array(count), new Float64Array(count)];
  const send = [new Float64Array(count), new Float64Array(count)];
  const ducked = [new Float64Array(count), new Float64Array(count)];
  const glitch = new Float64Array(count);
  const kickEnvelope = new Float64Array(count);
  const events = schedule(accentsOnly);
  for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
    const event = events[eventIndex];
    const { voice, level } = event;
    const start = sample(event.time);
    if (stops.some((stop) => start >= stop.start && start < stop.end) && voice !== "glitch")
      continue;
    const seconds = lengths[voice] ? (lengths[voice] * beat) / 0.5 : event.length * beat;
    const nextAccent = accentsOnly && events[eventIndex + 1];
    const size = Math.min(
      sample(seconds),
      count - start,
      nextAccent ? sample(nextAccent.time) - start - sample(0.005) : count,
    );
    const rand = randomSource(19237 + eventIndex * 7919);
    const filter = lowpass();
    const noiseFilter = lowpass();
    const noiseCeiling = lowpass();
    const noiseBody = lowpass();
    const pan = { hat: 0.23, arp: -0.24, rim: -0.14, openHat: -0.2 }[voice] ?? 0;
    const balance = [Math.sqrt((1 - pan) / 2), Math.sqrt((1 + pan) / 2)];
    let phase = 0,
      phase2 = 0,
      kickPhase = 0,
      previousNoise = 0,
      heldNoise = 0;
    const frequency = hz(event.note ?? 57);
    for (let i = 0; i < size; i++) {
      const t = i / rate;
      const u = t / seconds;
      const attack = Math.min(1, (i + 1) / (rate * 0.001));
      const release = Math.min(1, (size - i) / (rate * 0.015));
      const noise = rand();
      const highNoise = noiseCeiling(noise, 15000) - noiseFilter(noise, 3500);
      let x = 0;
      switch (voice) {
        case "kick":
        case "impact": {
          kickPhase += (tau * (48 + 115 * Math.exp(-t * 44))) / rate;
          const body = Math.sin(kickPhase) * Math.exp(-t * 8);
          x = 0.95 * body + highNoise * Math.exp(-t * 330) * 0.13;
          if (voice === "impact")
            x +=
              0.27 * Math.sin(tau * 37 * t) * Math.exp(-t * 3.6) +
              noiseFilter(noise, 2800) * Math.exp(-t * 15) * 0.42;
          kickEnvelope[start + i] = Math.max(kickEnvelope[start + i], Math.exp(-t * 13));
          break;
        }
        case "hat":
        case "openHat":
        case "tick":
          x = highNoise * Math.exp(-t * (voice === "openHat" ? 10 : voice === "tick" ? 90 : 38));
          break;
        case "rim":
          x = (0.7 * Math.cos(tau * 1750 * t) + 0.3 * highNoise) * Math.exp(-t * 65);
          break;
        case "clap": {
          const pulses = [0, 0.012, 0.024].reduce(
            (sum, delay) => sum + (t >= delay ? Math.exp(-(t - delay) * 130) : 0),
            0,
          );
          x =
            (filter(noise, 6500) - noiseBody(noise, 900)) *
            (pulses * 0.4 + 0.32 * Math.exp(-t * 22));
          break;
        }
        case "bass":
          phase = (phase + frequency / 2 / rate) % 1;
          x =
            (Math.sin(tau * phase) * 0.65 +
              Math.sin(tau * phase * 2) * 0.32 +
              Math.sin(tau * phase * 3) * 0.23 +
              Math.sin(tau * phase * 4) * 0.1) *
            Math.exp(-t * 7) *
            Math.min(1, t / 0.004);
          break;
        case "arp":
        case "stab": {
          const pitch =
            voice === "arp" ? hz([69, 72, 76, 79][Math.round(event.position * 4) % 4]) : frequency;
          const step = pitch / rate;
          phase = (phase + step) % 1;
          phase2 = (phase2 + step * 1.006) % 1;
          const saw =
            (2 * phase - 1 - blep(phase, step) + 2 * phase2 - 1 - blep(phase2, step * 1.006)) * 0.5;
          x =
            filter(saw, (voice === "stab" ? 900 : 1900) * Math.exp(-t * 13) + 220) *
            Math.exp(-t * (voice === "stab" ? 13 : 10));
          break;
        }
        case "pad": {
          const chord = { 45: [57, 60, 64, 71], 48: [55, 60, 64, 71], 43: [55, 59, 62, 69] }[
            event.note
          ];
          const chordSignal = chord.reduce(
            (sum, note, n) => sum + Math.cos(tau * hz(note) * (1 + (n - 1.5) * 0.001) * t) / 4,
            0,
          );
          const envelope = Math.min(1, (t + 0.00002) / 0.12) * Math.min(1, (seconds - t) / 0.45);
          x = filter(chordSignal, 950) * envelope;
          if (event.bar === outro.bar) x *= Math.exp(-t * 1.1);
          break;
        }
        case "sweep":
          phase = (phase + hz(57) / rate) % 1;
          x =
            filter(2 * phase - 1 - blep(phase, hz(57) / rate), 180 * 35 ** u) *
            Math.sin(Math.PI * u) *
            0.7;
          break;
        case "riser":
          x = (filter(noise, 10000) - noiseBody(noise, 300 + 2200 * u)) * u ** 2 * 0.6;
          break;
        case "glitch":
          if (i % 13 === 0) heldNoise = Math.round(noise * 7) / 7;
          x = (heldNoise - previousNoise) * Math.exp(-t * 52);
          previousNoise = heldNoise * 0.82;
          break;
      }
      x *= level * attack * release;
      if (voice === "glitch") {
        glitch[start + i] += x;
        continue;
      }
      const bus = voice === "bass" || voice === "pad" ? ducked : dry;
      for (let channel = 0; channel < 2; channel++) {
        bus[channel][start + i] += x * balance[channel];
        send[channel][start + i] += x * balance[channel] * sends[voice];
      }
    }
  }

  const delays = [0.071, 0.097, 0.113, 0.137].map((length) => ({
    buffer: new Float64Array(sample((length * beat) / 0.5)),
    position: 0,
    damp: 0,
  }));
  const stereo = [new Float64Array(count), new Float64Array(count)];
  const diagnosticResets = new Set(
    accentsOnly ? events.map((event) => sample(event.time) - sample(0.004)) : [],
  );
  let previous = [0, 0],
    dc = [0, 0],
    compressor = 1;
  for (let i = 0; i < count; i++) {
    const stop = stops.find((window) => i >= window.start && i < window.end);
    if ((stop && i === stop.start) || diagnosticResets.has(i)) {
      for (const delay of delays) {
        delay.buffer.fill(0);
        delay.damp = 0;
      }
      previous = [0, 0];
      dc = [0, 0];
    }
    const taps = delays.map((delay) => delay.buffer[delay.position]);
    for (let n = 0; n < delays.length; n++) delays[n].damp += 0.26 * (taps[n] - delays[n].damp);
    const sum = delays.reduce((total, delay) => total + delay.damp, 0);
    for (let n = 0; n < delays.length; n++) {
      const delay = delays[n];
      delay.buffer[delay.position] = stop
        ? 0
        : send[n % 2][i] * 0.5 + 0.76 * (sum * 0.5 - delay.damp);
      delay.position = (delay.position + 1) % delay.buffer.length;
    }
    const wet = [(taps[0] + taps[2] - taps[1]) * 0.43, (taps[1] + taps[3] - taps[2]) * 0.43];
    const values = [0, 1].map((ch) =>
      stop ? glitch[i] : dry[ch][i] + ducked[ch][i] * (1 - kickEnvelope[i] * 0.65) + wet[ch],
    );
    const peak = Math.max(...values.map(Math.abs));
    const target = peak > 0.4 ? (0.4 + (peak - 0.4) / 2.2) / peak : 1;
    compressor += (target < compressor ? 0.03 : 0.0003) * (target - compressor);
    const nextStop = stops.find((window) => i < window.start && i >= window.start - sample(0.003));
    const stopFade = nextStop ? (nextStop.start - i) / sample(0.003) : 1;
    const fade = clamp((duration - i / rate - 0.5) / 1.8, 0, 1) * stopFade;
    for (let ch = 0; ch < 2; ch++) {
      const value = values[ch] * compressor;
      dc[ch] = value - previous[ch] + 0.9974 * dc[ch];
      previous[ch] = value;
      stereo[ch][i] = stop && stop.id !== "crash" ? 0 : 0.79 * Math.tanh(dc[ch] * 2.8) * fade;
    }
  }
  return stereo;
}

function writeWave(path, stereo) {
  const wav = Buffer.alloc(44 + count * 4);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(count * 4, 40);
  for (let i = 0; i < count; i++)
    for (let ch = 0; ch < 2; ch++) {
      wav.writeInt16LE(Math.round(clamp(stereo[ch][i], -1, 1) * 32767), 44 + i * 4 + ch * 2);
    }
  writeFileSync(path, wav);
}

function readWave(path) {
  const data = readFileSync(path);
  const samples = (data.length - 44) / 4;
  const channels = [new Float64Array(samples), new Float64Array(samples)];
  for (let i = 0; i < samples; i++)
    for (let ch = 0; ch < 2; ch++) {
      channels[ch][i] = data.readInt16LE(44 + i * 4 + ch * 2) / 32768;
    }
  return channels;
}

function fftEnergy(channels, start, end) {
  const size = 8192;
  const energy = [0, 0, 0, 0, 0];
  for (const channel of channels)
    for (let offset = start; offset + size <= end; offset += size / 2) {
      const real = new Float64Array(size),
        imag = new Float64Array(size);
      for (let i = 0; i < size; i++)
        real[i] = channel[offset + i] * (0.5 - 0.5 * Math.cos((tau * i) / (size - 1)));
      for (let i = 1, j = 0; i < size; i++) {
        let bit = size >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) [real[i], real[j]] = [real[j], real[i]];
      }
      for (let length = 2; length <= size; length *= 2)
        for (let base = 0; base < size; base += length) {
          for (let k = 0; k < length / 2; k++) {
            const angle = (-tau * k) / length,
              a = base + k,
              b = a + length / 2;
            const re = real[b] * Math.cos(angle) - imag[b] * Math.sin(angle);
            const im = real[b] * Math.sin(angle) + imag[b] * Math.cos(angle);
            real[b] = real[a] - re;
            imag[b] = imag[a] - im;
            real[a] += re;
            imag[a] += im;
          }
        }
      for (let bin = 1; bin <= size / 2; bin++) {
        const frequency = (bin * rate) / size;
        const band =
          frequency < 60
            ? 0
            : frequency < 250
              ? 1
              : frequency < 2000
                ? 2
                : frequency < 8000
                  ? 3
                  : 4;
        energy[band] += real[bin] ** 2 + imag[bin] ** 2;
      }
    }
  const total = energy.reduce((a, b) => a + b, 0);
  return energy.map((value) => +((100 * value) / total).toFixed(2));
}

function verify() {
  const mainPath = new URL("music.wav", out);
  const main = readWave(mainPath);
  const accents = readWave(new URL("music-accents.wav", out));
  if (main[0].length !== count || accents[0].length !== count)
    throw new Error("Incorrect WAV sample count");
  const timings = cues
    .filter((cue) => ["impact", "hit", "tick"].includes(cue.accent))
    .map((cue) => {
      const expected = sample(cueTime(cue));
      let onset = -1;
      for (let i = expected - sample(0.002); i < expected + sample(0.002); i++) {
        if (Math.max(...accents.map((ch) => Math.abs(ch[i]))) >= 2 / 32768) {
          onset = i;
          break;
        }
      }
      if (onset < 0) throw new Error(`No onset within 2 ms for ${cue.id}`);
      return { id: cue.id, offsetMs: ((onset - expected) / rate) * 1000 };
    });
  const rms = (start, end) => {
    let sum = 0,
      peak = 0;
    for (let i = start; i < end; i++)
      for (const channel of main) {
        sum += channel[i] ** 2;
        peak = Math.max(peak, Math.abs(channel[i]));
      }
    const value = Math.sqrt(sum / ((end - start) * 2));
    return { rms: value, dBFS: value ? 20 * Math.log10(value) : "-Infinity", peak };
  };
  const windows = Object.fromEntries(stops.map((stop) => [stop.id, rms(stop.start, stop.end)]));
  const crash = stops.find((stop) => stop.id === "crash");
  windows.crashAfterBlip = rms(crash.start + sample((0.14 * beat) / 0.5), crash.end);
  windows.lastHalfSecond = rms(count - sample(0.5), count);
  const offsets = timings.map((entry) => entry.offsetMs);
  console.log(
    JSON.stringify(
      {
        samples: main[0].length,
        expected: count,
        duration,
        bpm: tempo.bpm,
        timings,
        maxOffsetMs: Math.max(...offsets),
        meanOffsetMs: offsets.reduce((a, b) => a + b) / offsets.length,
        windows,
        anatomyBandPercent: fftEnergy(
          main,
          sample(at(anatomy.bar)),
          sample(at(anatomy.bar + anatomy.bars)),
        ),
      },
      null,
      2,
    ),
  );
  const measured = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", fileURLToPath(mainPath), "-af", "ebur128=peak=true", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  if (measured.status !== 0) throw new Error(measured.stderr || measured.error?.message);
  console.log(measured.stderr.slice(measured.stderr.lastIndexOf("Summary:")));
}

mkdirSync(out, { recursive: true });
if (process.argv.includes("--verify")) verify();
else {
  const accentsOnly = process.argv.includes("--accents-only");
  const destination = new URL(accentsOnly ? "music-accents.wav" : "music.wav", out);
  writeWave(destination, render(accentsOnly));
  console.log(
    `${fileURLToPath(destination)}: ${count} stereo frames, ${duration}s, ${rate} Hz PCM16`,
  );
}
