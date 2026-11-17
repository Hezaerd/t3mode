import type { InstalledPlugin, PluginOffer } from "@t3mode/shared/Plugins";
import { compareVersions } from "@t3mode/shared/Semver";

export type OfferState =
  | { readonly kind: "new" }
  | { readonly kind: "installed" }
  | { readonly kind: "update"; readonly from: string }
  | { readonly kind: "older"; readonly installed: string };

export const offerState = (
  offer: Extract<PluginOffer, { kind: "ready" }>,
  installed: InstalledPlugin | undefined,
): OfferState => {
  if (!installed) return { kind: "new" };
  const order = compareVersions(offer.manifest.version, installed.version);
  if (order > 0) return { kind: "update", from: installed.version };
  if (order < 0) return { kind: "older", installed: installed.version };
  return { kind: "installed" };
};
