import "client-only";

import {
  MAINNET,
  rewriteUrl,
  type PubkyNetworkConfig,
  type PubkyUrlRewrite,
} from "@/libs/pubkyNetwork";

let configured: PubkyNetworkConfig = MAINNET;
const rewrittenScopes = new WeakSet<object>();

/**
 * Sets the network every SDK client on this page is built for, from the root layout's public
 * configuration, before anything on the page uses the SDK. A testnet's request rewrites are
 * installed once, in the browser only; mainnet installs nothing.
 */
export function configurePubkyNetwork(config: PubkyNetworkConfig): void {
  configured = config;
  if (config.network === "testnet" && typeof window !== "undefined")
    installUrlRewrites(window, config.rewrites);
}

/** The network the SDK adapter builds its clients for; mainnet until the layout says otherwise. */
export function pubkyNetwork(): PubkyNetworkConfig {
  return configured;
}

/**
 * Sends a request whose URL a testnet rewrite covers to its target instead, for every caller of
 * `fetch` in `scope`, the SDK's WASM included. Only covered URLs change: everything else reaches
 * the original `fetch` untouched. Installed once per scope; an empty list installs nothing.
 */
export function installUrlRewrites(
  scope: { fetch: typeof fetch; location?: { href: string } },
  rewrites: readonly PubkyUrlRewrite[],
): void {
  if (rewrites.length === 0 || rewrittenScopes.has(scope)) return;
  rewrittenScopes.add(scope);
  const original = scope.fetch;
  scope.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = rewrittenTarget(input, rewrites, scope.location?.href);
    if (target === undefined) return original.call(scope, input, init);
    if (typeof input === "string" || input instanceof URL)
      return original.call(scope, target, init);
    return original.call(scope, await retarget(input, target), init);
  };
}

function rewrittenTarget(
  input: RequestInfo | URL,
  rewrites: readonly PubkyUrlRewrite[],
  base: string | undefined,
): string | undefined {
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return rewriteUrl(new URL(url, base).href, rewrites);
  } catch {
    return undefined;
  }
}

/** The same request to another URL. A body is read once here; GET and HEAD carry none. */
async function retarget(request: Request, url: string): Promise<Request> {
  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    ...(body === undefined ? {} : { body }),
    credentials: request.credentials,
    cache: request.cache,
    redirect: request.redirect,
    integrity: request.integrity,
    keepalive: request.keepalive,
    referrerPolicy: request.referrerPolicy,
    signal: request.signal,
  });
}
