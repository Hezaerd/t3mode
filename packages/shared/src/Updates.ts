// T3 Code updates, installed by t3mode (see "Updates" in docs/architecture.md). Every T3 Code
// update replaces app.asar and removes the shim, so t3mode turns T3 Code's own updater off,
// downloads and checks each update itself, and installs it from a helper that puts the shim
// back before T3 Code starts again. Types only: the page bundle imports this file.

export type UpdatePhase =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "up-to-date"; readonly latest: string }
  | {
      readonly kind: "downloading";
      readonly version: string;
      readonly received: number;
      readonly total: number;
    }
  | { readonly kind: "verifying"; readonly version: string }
  /** Downloaded and verified. It installs when T3 Code quits. */
  | { readonly kind: "ready"; readonly version: string }
  | { readonly kind: "failed"; readonly message: string };

export interface UpdateStatus {
  /** t3mode installs updates in this launch: its setting was on when T3 Code started. */
  readonly managed: boolean;
  /** The setting now; a change applies at the next launch. */
  readonly manageSetting: boolean;
  readonly current: string;
  /** T3 Code's update channel: "nightly" or "latest". */
  readonly channel: string;
  readonly phase: UpdatePhase;
  /** When the last check finished, in ms since the epoch. */
  readonly checkedAt: number | null;
  /** False in the dev sandbox, which never runs a real installer. */
  readonly installable: boolean;
}

export type UpdateAction = "status" | "check" | "restart";
