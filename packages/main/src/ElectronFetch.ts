// Requests from main go through Electron's own network stack, so system proxies apply as they
// do for T3 Code.
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient } from "effect/http";

import { net } from "electron";

const electronFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  net.fetch(input instanceof URL ? input.href : (input as string), init)) as typeof fetch;

/** FetchHttpClient reads both services when a request runs, so they wrap each call, not a layer. */
export const withElectronFetch = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provideService(FetchHttpClient.Fetch, electronFetch),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
  );
