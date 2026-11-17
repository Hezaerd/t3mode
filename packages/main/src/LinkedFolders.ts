// The folders of linked plugins whose tool servers are registered. Their scripts live outside
// <home>/plugins/, so the reconcile records them here and the updater passes them to the update
// helper, which stops tool servers running from them before it waits for T3 Code to exit.
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export class LinkedFolders extends Context.Service<
  LinkedFolders,
  {
    readonly get: () => ReadonlyArray<string>;
    readonly set: (folders: ReadonlyArray<string>) => void;
  }
>()("@t3mode/main/LinkedFolders") {}

export const layer = Layer.sync(LinkedFolders, () => {
  let folders: ReadonlyArray<string> = [];
  return LinkedFolders.of({
    get: () => folders,
    set: (next) => {
      folders = next;
    },
  });
});
