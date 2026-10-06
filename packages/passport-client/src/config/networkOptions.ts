import { invalidOption } from "./PassportConfigError.js";

export type PubkyNetwork = "mainnet" | "testnet";

/** The Pubky network a client signs in on, with the relays its own SDK client uses. */
export interface NetworkOptions {
  readonly network: PubkyNetwork;
  /** PKARR relays for the client's own SDK; unset uses the SDK's mainnet relays. */
  readonly pkarrRelays?: readonly string[];
  /** The HTTP relay inbox of the sign-in request; unset uses the SDK's default relay. */
  readonly httpRelay?: string;
}

const MAX_PKARR_RELAYS = 8;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Explicit network settings with no implicit defaults: testnet needs both relays. Relay URLs are
 * HTTPS (HTTP only on a loopback host) without credentials, query or fragment.
 */
export function resolveNetworkOptions(input: {
  network?: unknown;
  pkarrRelays?: unknown;
  httpRelay?: unknown;
}): NetworkOptions {
  const network = input.network === undefined ? "mainnet" : input.network;
  if (network !== "mainnet" && network !== "testnet")
    invalidOption("network", 'Use "mainnet" or "testnet".');
  const pkarrRelays =
    input.pkarrRelays === undefined ? undefined : resolvePkarrRelays(input.pkarrRelays);
  const httpRelay =
    input.httpRelay === undefined
      ? undefined
      : relayUrl(input.httpRelay, "httpRelay", "Use an HTTPS relay URL without credentials.");
  if (network === "testnet" && (!pkarrRelays || httpRelay === undefined))
    invalidOption(
      pkarrRelays ? "httpRelay" : "pkarrRelays",
      "A testnet needs both its PKARR relays and its HTTP relay.",
    );
  return Object.freeze({
    network,
    ...(pkarrRelays ? { pkarrRelays } : {}),
    ...(httpRelay !== undefined ? { httpRelay } : {}),
  });
}

function resolvePkarrRelays(input: unknown): readonly string[] {
  const entries =
    typeof input === "string"
      ? input.split(",").map((entry) => entry.trim())
      : Array.isArray(input)
        ? [...(input as unknown[])]
        : undefined;
  if (!entries || entries.length === 0 || entries.length > MAX_PKARR_RELAYS)
    invalidOption("pkarrRelays", `Use 1 to ${MAX_PKARR_RELAYS} PKARR relay URLs.`);
  const relays = entries.map((entry) => {
    const url = relayUrl(entry, "pkarrRelays", "Use HTTPS PKARR relay URLs without credentials.");
    // The relay client appends the key as a path segment, so a trailing slash would double it.
    return url.replace(/(?<=[^/])\/+$/u, "");
  });
  return Object.freeze([...new Set(relays)]);
}

function relayUrl(input: unknown, option: string, message: string): string {
  if (typeof input !== "string" || input.length > 2048 || /[\p{Cc}\s]/u.test(input))
    return invalidOption(option, message);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return invalidOption(option, message);
  }
  const secure =
    url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
  // An empty query or fragment ("?", "#") survives in href but not in search or hash.
  if (!secure || url.username || url.password || /[?#]/u.test(url.href))
    invalidOption(option, message);
  return url.href;
}
