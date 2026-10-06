/** The Pubky network an instance runs on, from `PUBKY_NETWORK`; unset is mainnet. */
export type PubkyNetworkName = "mainnet" | "testnet";

/**
 * One testnet request rewrite: a request whose URL is `from` or lies below it goes to `to`
 * instead, with the rest of its path, query and fragment. Both are normalized without a trailing
 * slash, so `http://localhost:6286` also matches `http://localhost:6286/pub/…`.
 */
export type PubkyUrlRewrite = Readonly<{ from: string; to: string }>;

/** What the browser needs to reach the instance's network. Mainnet uses the SDK's defaults. */
export type PubkyNetworkConfig =
  | Readonly<{ network: "mainnet" }>
  | Readonly<{
      network: "testnet";
      /** PKARR relays for every SDK client on the page. */
      pkarrRelays: readonly string[];
      /** Requests rewritten to reach the testnet's services from this origin. */
      rewrites: readonly PubkyUrlRewrite[];
    }>;

export const MAINNET: PubkyNetworkConfig = Object.freeze({ network: "mainnet" });

/**
 * The root layout names the instance's network in this `<meta>`, so code that runs before
 * hydration (the request entry and its opener channel) can read it without any React context.
 */
export const PUBKY_NETWORK_META_NAME = "pubky-network";

/** The network the page's layout named; a page without the meta is mainnet. */
export function readPageNetwork(document: Pick<Document, "querySelector">): PubkyNetworkName {
  try {
    const content = document
      .querySelector(`meta[name="${PUBKY_NETWORK_META_NAME}"]`)
      ?.getAttribute("content");
    return content === "testnet" ? "testnet" : "mainnet";
  } catch {
    return "mainnet";
  }
}

export function isPubkyNetworkName(value: unknown): value is PubkyNetworkName {
  return value === "mainnet" || value === "testnet";
}

/** Strips a trailing slash, so `https://a.example/x/` and `https://a.example/x` are one prefix. */
export function withoutTrailingSlash(href: string): string {
  return href.replace(/(?<=[^/])\/+$/u, "");
}

/**
 * The URL a testnet request goes to instead, or `undefined` when no rule covers it. The longest
 * matching `from` wins, and a prefix matches only at a path boundary: `https://a.example/x` covers
 * `https://a.example/x/y` and `https://a.example/x?q`, never `https://a.example/xy`.
 */
export function rewriteUrl(url: string, rewrites: readonly PubkyUrlRewrite[]): string | undefined {
  let best: PubkyUrlRewrite | undefined;
  for (const rule of rewrites) {
    const covered =
      url === rule.from ||
      (url.startsWith(rule.from) && "/?#".includes(url.charAt(rule.from.length)));
    if (covered && (!best || rule.from.length > best.from.length)) best = rule;
  }
  return best ? best.to + url.slice(best.from.length) : undefined;
}
