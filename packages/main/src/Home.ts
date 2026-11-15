import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { app } from "electron";

import { type HomeLayout, homeLayout, resolveHomeRoot } from "@t3mode/shared/Layout";

export class Home extends Context.Service<Home, { readonly layout: HomeLayout }>()(
  "@t3mode/main/Home",
) {}

export const layer = Layer.effect(
  Home,
  Effect.sync(() =>
    Home.of({ layout: homeLayout(resolveHomeRoot(process.env, app.getPath("home"))) }),
  ),
);
