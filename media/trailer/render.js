import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { duration, video } from "./timeline.js";

const root = dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    scene: { type: "string", default: "scene.html" },
    audio: { type: "string" },
    out: { type: "string", default: "out/trailer.mp4" },
    from: { type: "string", default: "0" },
    to: { type: "string", default: String(duration) },
    stills: { type: "string" },
    fps: { type: "string", default: String(video.fps) },
    browser: { type: "string" },
  },
});

const fps = Number(args.fps);
const browserPath =
  args.browser ??
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ].find((path) => existsSync(path));
if (!browserPath) throw new Error("no Edge or Chrome found; pass --browser");

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const serve = () =>
  new Promise((done) => {
    const server = createServer(async (request, response) => {
      const path = normalize(
        join(root, decodeURIComponent(new URL(request.url, "http://x").pathname)),
      );
      if (!path.startsWith(root)) return response.writeHead(403).end();
      try {
        const body = await readFile(path);
        response.writeHead(200, {
          "content-type": mime[extname(path)] ?? "application/octet-stream",
        });
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1", () => done(server));
  });

const devtoolsUrl = (browser) =>
  new Promise((done, fail) => {
    let log = "";
    browser.stderr.on("data", (chunk) => {
      log += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (match) done(match[1]);
    });
    browser.on("exit", (code) => fail(new Error(`browser exited ${code}: ${log}`)));
  });

const connect = (url) =>
  new Promise((done, fail) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    const listeners = new Set();
    let next = 0;
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter.fail(new Error(`${waiter.method}: ${message.error.message}`));
        else waiter.done(message.result);
      } else for (const listener of listeners) listener(message);
    };
    socket.onerror = () => fail(new Error("CDP socket error"));
    socket.onopen = () =>
      done({
        send: (method, params = {}, sessionId) =>
          new Promise((resolveSend, failSend) => {
            const id = ++next;
            pending.set(id, { done: resolveSend, fail: failSend, method });
            socket.send(JSON.stringify({ id, method, params, sessionId }));
          }),
        on: (listener) => listeners.add(listener),
        close: () => socket.close(),
      });
  });

const frameTimes = () => {
  if (args.stills) return args.stills.split(",").map(Number);
  const first = Math.round(Number(args.from) * fps);
  const last = Math.round(Number(args.to) * fps);
  return Array.from({ length: last - first }, (_, index) => (first + index) / fps);
};

const encoder = (output) => {
  const audio = args.audio
    ? [
        "-ss",
        args.from,
        "-t",
        String(Number(args.to) - Number(args.from)),
        "-i",
        resolve(root, args.audio),
      ]
    : [];
  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "image2pipe",
      "-c:v",
      "png",
      "-framerate",
      String(fps),
      "-i",
      "-",
      ...audio,
      "-map",
      "0:v",
      ...(args.audio ? ["-map", "1:a", "-c:a", "aac", "-b:a", "256k", "-ar", "48000"] : []),
      "-vf",
      "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "14",
      "-profile:v",
      "high",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-colorspace",
      "bt709",
      "-r",
      String(fps),
      "-movflags",
      "+faststart",
      output,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const finished = new Promise((done, fail) =>
    ffmpeg.on("exit", (code) => (code === 0 ? done() : fail(new Error(`ffmpeg exited ${code}`)))),
  );
  return {
    write: (buffer) =>
      new Promise((done) =>
        ffmpeg.stdin.write(buffer) ? done() : ffmpeg.stdin.once("drain", done),
      ),
    end: () => (ffmpeg.stdin.end(), finished),
  };
};

const server = await serve();
const profile = await mkdtemp(join(tmpdir(), "trailer-browser-"));
const browser = spawn(
  browserPath,
  [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    `--window-size=${video.width},${video.height}`,
    "--force-device-scale-factor=1",
    "--force-color-profile=srgb",
    "--hide-scrollbars",
    "--mute-audio",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-extensions",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);

try {
  const cdp = await connect(await devtoolsUrl(browser));
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  const errors = [];
  cdp.on((message) => {
    if (message.method === "Runtime.exceptionThrown")
      errors.push(
        message.params.exceptionDetails.exception?.description ??
          message.params.exceptionDetails.text,
      );
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error")
      errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: video.width,
    height: video.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const loaded = new Promise((done) =>
    cdp.on((message) => message.method === "Page.loadEventFired" && done()),
  );
  await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/${args.scene}` });

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails)
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  await loaded;
  if (errors.length) throw new Error(errors.join("\n"));
  await evaluate("window.trailer.ready.then(() => true)");

  const capture = async (time) => {
    await evaluate(`window.trailer.seek(${time}), true`);
    if (errors.length) throw new Error(`at t=${time}: ${errors.join("\n")}`);
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    return Buffer.from(data, "base64");
  };

  const times = frameTimes();
  const started = Date.now();
  if (args.stills) {
    const folder = resolve(root, args.out);
    await mkdir(folder, { recursive: true });
    for (const time of times) {
      // eslint-disable-next-line no-await-in-loop
      const png = await capture(time);
      // eslint-disable-next-line no-await-in-loop
      await writeFile(join(folder, `t${time.toFixed(3)}.png`), png);
    }
    console.log(`${times.length} stills in ${folder}`);
  } else {
    const output = resolve(root, args.out);
    await mkdir(dirname(output), { recursive: true });
    const sink = encoder(output);
    for (const [index, time] of times.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const png = await capture(time);
      // eslint-disable-next-line no-await-in-loop
      await sink.write(png);
      if (index % fps === 0) process.stdout.write(`\r${index}/${times.length} frames`);
    }
    await sink.end();
    console.log(
      `\n${times.length} frames in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${output}`,
    );
  }
  cdp.close();
} finally {
  browser.kill();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
