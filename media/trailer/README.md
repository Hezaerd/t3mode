# Render the t3mode trailer

The trailer is a 34-second, 1080×1080, 60 fps video for X. It shows plugins that ship a backend. Its music and its motion both read their timing from `timeline.js`, so they stay on the same beats.

You need Node 24, `ffmpeg` on `PATH`, and Microsoft Edge or Google Chrome. Run the commands from this folder.

## Render the video

1. Write the scratch track to `out/music.wav`:

   ```sh
   node music.js
   ```

2. Render the video with that track:

   ```sh
   node render.js --audio out/music.wav --out out/t3mode-trailer.mp4
   ```

   It takes about two minutes and prints the frame count at the end, which is 2040.

3. Check that each cue has motion and a sound within a frame of each other, and list any stretch with no motion longer than 1.5 s:

   ```sh
   node cue-check.js out/t3mode-trailer.mp4
   ```

To look at single frames, pass times in seconds: `node render.js --stills 8,12.5 --out out/stills`. To render part of the video, pass `--from` and `--to`.

## Change the timing

`timeline.js` holds the tempo, the sections in bars, and every cue as a bar and a beat. The scene places each move at a cue plus a number of beats, and `music.js` plays each cue's `accent`. Move a cue there and both follow.

## Use a real track

The music in `music.js` is a placeholder made from code. To use a licensed track:

1. Set `tempo.bpm` to the track's tempo and `tempo.offset` to the time of its first downbeat, in seconds.
2. Move the `drop`, `payoff` and `logo` cues to the track's drop and its big hits, if they fall on other bars.
3. Pass the track to `render.js` with `--audio`.

## Check the renderer

`spike.html` flashes on every beat and gives each frame its own color. Render it with a click track and check it:

```sh
ffmpeg -y -f lavfi -i "aevalsrc='0.8*sin(2*PI*1000*t)*lt(mod(t\,0.5)\,0.01)':s=48000:d=4" out/clicks.wav
node render.js --scene spike.html --audio out/clicks.wav --out out/spike.mp4 --to 4
node sync-check.js out/spike.mp4
```

`stale` must be 0. Each click must land within a millisecond of its flash.
