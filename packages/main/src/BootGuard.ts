// Safe mode. t3mode skips itself for one launch when asked to (the SAFE_MODE file),
// or when the last launches never reached a working window.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { app } from "electron";

import { isIndicator } from "./DesktopIndicator.ts";
import { Files } from "./Files.ts";
import { Home } from "./Home.ts";

/** Launches in a row that never reported `ready` before safe mode kicks in. */
export const FAILED_BOOT_LIMIT = 2;
/** Renderer crashes within `CRASH_WINDOW_MS` that request safe mode for the next launch. */
export const CRASH_LIMIT = 2;
export const CRASH_WINDOW_MS = 60_000;

export const BootState = Schema.Struct({
  version: Schema.Literal(1),
  failedBoots: Schema.Int,
});
export type BootState = typeof BootState.Type;

const initialState: BootState = { version: 1, failedBoots: 0 };
const BootStateJson = Schema.fromJsonString(BootState);

export type BootDecision =
  | { readonly mode: "normal"; readonly next: BootState }
  | {
      readonly mode: "safe";
      readonly reason: "requested" | "failed-boots";
      readonly next: BootState;
    };

export const decideBoot = (state: BootState, safeModeRequested: boolean): BootDecision => {
  if (safeModeRequested) return { mode: "safe", reason: "requested", next: initialState };
  if (state.failedBoots >= FAILED_BOOT_LIMIT) {
    return { mode: "safe", reason: "failed-boots", next: initialState };
  }
  // Counted as failed until the page reports ready.
  return { mode: "normal", next: { ...state, failedBoots: state.failedBoots + 1 } };
};

/** Keeps crash times inside the window and says whether the limit was reached. */
export const recordCrash = (
  times: ReadonlyArray<number>,
  now: number,
): { readonly times: ReadonlyArray<number>; readonly trip: boolean } => {
  const recent = [...times.filter((time) => now - time < CRASH_WINDOW_MS), now];
  return { times: recent, trip: recent.length >= CRASH_LIMIT };
};

export class BootGuard extends Context.Service<
  BootGuard,
  {
    /** Decides this launch's mode and records it. Never fails: unreadable state counts as fresh. */
    readonly begin: Effect.Effect<BootDecision>;
    /** The page is up, so this launch did not fail. */
    readonly markHealthy: Effect.Effect<void>;
    /** Requests safe mode for the next launch after repeated renderer crashes. */
    readonly watchCrashes: Effect.Effect<void>;
  }
>()("@t3mode/main/BootGuard") {}

export const layer = Layer.effect(
  BootGuard,
  Effect.gen(function* () {
    const files = yield* Files;
    const { layout } = yield* Home;
    const context = yield* Effect.context<never>();

    const readState = files.readText(layout.state).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(initialState),
          onSome: (text) => Schema.decodeEffect(BootStateJson)(text),
        }),
      ),
      Effect.catch((error) =>
        Effect.logWarning("Boot state unreadable, starting fresh", error).pipe(
          Effect.as(initialState),
        ),
      ),
    );

    const writeState = (state: BootState) =>
      Schema.encodeEffect(BootStateJson)(state).pipe(
        Effect.flatMap((text) => files.writeTextAtomic(layout.state, text)),
        Effect.catch((error) => Effect.logWarning("Could not save boot state", error)),
      );

    const begin = Effect.gen(function* () {
      const safeModeRequested = yield* files.exists(layout.safeMode);
      const decision = decideBoot(yield* readState, safeModeRequested);
      yield* writeState(decision.next);
      if (safeModeRequested) {
        yield* files
          .remove(layout.safeMode)
          .pipe(Effect.catch((error) => Effect.logWarning("Could not clear SAFE_MODE", error)));
      }
      return decision;
    }).pipe(Effect.withSpan("BootGuard.begin"));

    const markHealthy = writeState(initialState).pipe(Effect.withSpan("BootGuard.markHealthy"));

    const requestSafeMode = files.writeTextAtomic(layout.safeMode, "renderer crash loop\n").pipe(
      Effect.andThen(Effect.logError("Renderer keeps crashing; next launch runs without t3mode")),
      Effect.catch((error) => Effect.logError("Could not request safe mode", error)),
    );

    const watchCrashes = Effect.sync(() => {
      let crashes: ReadonlyArray<number> = [];
      app.on("render-process-gone", (_event, contents, details) => {
        // The desktop indicator's page runs no plugin code, so its crash says nothing about them.
        if (details.reason === "clean-exit" || isIndicator(contents)) return;
        // @effect-diagnostics-next-line globalDate:off - Called from an Electron event, outside any fiber.
        const result = recordCrash(crashes, Date.now());
        crashes = result.times;
        if (result.trip) Effect.runSyncWith(context)(requestSafeMode);
      });
    });

    return BootGuard.of({ begin, markHealthy, watchCrashes });
  }),
);
