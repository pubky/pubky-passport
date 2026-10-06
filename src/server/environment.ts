import "server-only";

import { isCspSafeHostname } from "@/libs/http/cspSafeHostname";
import { DEFAULT_PUBKY_HTTP_RELAY_URL, PASSPORT_KEY_ID_PATTERN } from "@/libs/passportPolicy";
import {
  passportProviderSchema,
  type PassportProvider,
  type PassportProviderSettings,
} from "@/libs/passportProvider";
import { isCanonicalPubkyPublicKey } from "@/libs/pubkyPublicKey";
import {
  MAINNET,
  withoutTrailingSlash,
  type PubkyNetworkConfig,
  type PubkyUrlRewrite,
} from "@/libs/pubkyNetwork";

const MINIMUM_SERVER_SECRET_BYTES = 32;
const MAXIMUM_PKARR_RELAYS = 8;
const MAXIMUM_URL_REWRITES = 16;
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TESTNET_VARIABLES = [
  "PUBKY_TESTNET_PKARR_RELAYS",
  "PUBKY_TESTNET_HTTP_RELAY",
  "PUBKY_TESTNET_URL_REWRITES_JSON",
] as const;

/**
 * Parses every public setting once. `instance` is the only part rendered to the browser.
 *
 * @throws {Error} when required public configuration is missing or invalid.
 */
export function getPublicEnvironment() {
  const { googleEnabled, ...provider } = parsePassportProviderSettings();
  const configuredGoogleClientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const google = googleEnabled ?? Boolean(configuredGoogleClientId);
  if (google && !configuredGoogleClientId) {
    throw new Error("GOOGLE_CLIENT_ID is required when Google is enabled.");
  }
  const googleClientId = google ? configuredGoogleClientId : "";
  const requiresHomegate =
    google || provider.verificationMethods.some((method) => method !== "invite");
  const homegate = requiresHomegate
    ? parseHomegateUrl(requireEnvironmentVariable("HOMEGATE_URL"))
    : null;
  const network = parsePubkyNetwork();

  const httpRelay =
    network.httpRelay ??
    parseHttpsUrl(
      process.env.PUBKY_HTTP_RELAY_URL?.trim() || DEFAULT_PUBKY_HTTP_RELAY_URL,
      "PUBKY_HTTP_RELAY_URL",
      "url",
    ).href;

  const instance: PassportProvider = {
    ...provider,
    features: { google },
    homeserver: parseProviderHomeserver(),
    httpRelay,
    network: network.config,
  };
  return {
    googleClientId,
    homegateBaseUrl: homegate?.href ?? "",
    /** `null` on an instance without Homegate, which then names no Homegate origin in CSP. */
    homegateOrigin: homegate?.origin ?? null,
    instance,
    /**
     * What a testnet adds to `connect-src`: its PKARR relay origins on every page, in place of
     * the public ones, and on the signer pages also its plain-HTTP loopback origins, which the
     * signer's `https:` does not cover. Mainnet adds nothing.
     */
    networkConnectSources: network.connectSources,
  };
}

/**
 * `PUBKY_NETWORK` and, on a testnet, its relays and request rewrites. Unset is mainnet, exactly
 * as before; a testnet variable without `PUBKY_NETWORK=testnet` fails startup rather than being
 * ignored, and so does `PUBKY_HTTP_RELAY_URL` next to a testnet's own relay.
 *
 * @throws {Error} naming the variable, never its value.
 */
function parsePubkyNetwork(): {
  config: PubkyNetworkConfig;
  httpRelay?: string;
  connectSources: { all: readonly string[]; signer: readonly string[] };
} {
  const network = process.env.PUBKY_NETWORK?.trim() || "mainnet";
  if (network !== "mainnet" && network !== "testnet") {
    throw new Error('PUBKY_NETWORK must be "mainnet" or "testnet".');
  }
  if (network === "mainnet") {
    for (const name of TESTNET_VARIABLES) {
      if (process.env[name]?.trim()) throw new Error(`${name} requires PUBKY_NETWORK=testnet.`);
    }
    return { config: MAINNET, connectSources: { all: [], signer: [] } };
  }
  if (process.env.PUBKY_HTTP_RELAY_URL?.trim()) {
    throw new Error("Use PUBKY_TESTNET_HTTP_RELAY instead of PUBKY_HTTP_RELAY_URL on a testnet.");
  }

  const relayEntries = requireEnvironmentVariable("PUBKY_TESTNET_PKARR_RELAYS")
    .split(",")
    .map((entry) => entry.trim());
  if (relayEntries.length > MAXIMUM_PKARR_RELAYS) {
    throw new Error(`PUBKY_TESTNET_PKARR_RELAYS takes at most ${MAXIMUM_PKARR_RELAYS} URLs.`);
  }
  const pkarrRelays = [
    ...new Set(
      relayEntries.map((entry) =>
        // The relay client appends the key as a path segment: no trailing slash.
        withoutTrailingSlash(parseNetworkUrl(entry, "PUBKY_TESTNET_PKARR_RELAYS").href),
      ),
    ),
  ];
  const httpRelay = parseNetworkUrl(
    requireEnvironmentVariable("PUBKY_TESTNET_HTTP_RELAY"),
    "PUBKY_TESTNET_HTTP_RELAY",
  );
  const rewrites = parseUrlRewrites();

  const targets = [...pkarrRelays.map((relay) => new URL(relay)), httpRelay];
  for (const rewrite of rewrites) targets.push(new URL(rewrite.to));
  const plainHttp = targets.filter((url) => url.protocol === "http:").map((url) => url.origin);
  return {
    config: Object.freeze({
      network: "testnet",
      pkarrRelays: Object.freeze(pkarrRelays),
      rewrites: Object.freeze(rewrites),
    }),
    httpRelay: httpRelay.href,
    connectSources: {
      all: [...new Set(pkarrRelays.map((relay) => new URL(relay).origin))],
      signer: [...new Set(plainHttp)],
    },
  };
}

/**
 * `PUBKY_TESTNET_URL_REWRITES_JSON`: `{ "<from URL prefix>": "<to URL prefix>" }`. It lets one
 * origin reach a testnet whose services announce other addresses, such as a homeserver whose
 * PKARR record names `localhost` (the SDK then calls `http://localhost:<port>`) or an app's relay
 * behind another origin's login. `from` takes any HTTP(S) address; `to` follows the relay rules.
 */
function parseUrlRewrites(): PubkyUrlRewrite[] {
  const name = "PUBKY_TESTNET_URL_REWRITES_JSON";
  const configuration = process.env[name]?.trim();
  if (!configuration) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(configuration);
  } catch {
    // Parser messages quote the input, so do not retain the cause.
    throw new Error(`${name} must be valid JSON.`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be an object of URL prefixes.`);
  }
  const entries = Object.entries(parsed);
  if (entries.length > MAXIMUM_URL_REWRITES) {
    throw new Error(`${name} takes at most ${MAXIMUM_URL_REWRITES} rewrites.`);
  }
  const rewrites = entries.map(([from, to]) => {
    if (typeof to !== "string") throw new Error(`${name} must map URLs to URLs.`);
    return Object.freeze({
      from: withoutTrailingSlash(parseRewriteSource(from, name).href),
      to: withoutTrailingSlash(parseNetworkUrl(to, name).href),
    });
  });
  if (new Set(rewrites.map((rewrite) => rewrite.from)).size !== rewrites.length) {
    throw new Error(`${name} repeats a URL prefix.`);
  }
  return rewrites;
}

/** Any HTTP(S) address a request may name, without credentials, query or fragment. */
function parseRewriteSource(value: string, name: string): URL {
  const invalid = `${name} must map HTTP(S) URL prefixes without credentials, query or fragment.`;
  let url: URL;
  try {
    url = new URL(value);
  } catch (e) {
    throw new Error(invalid, { cause: e });
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== "" ||
    /[?#]/u.test(url.href)
  ) {
    throw new Error(invalid);
  }
  return url;
}

/**
 * A testnet URL the browser calls: HTTPS on a host CSP can name, or plain HTTP on a loopback
 * host for a testnet on the same machine; a path is allowed, credentials, query and fragment not.
 */
function parseNetworkUrl(value: string, name: string): URL {
  const invalid = `${name} must use HTTPS URLs (HTTP only on localhost).`;
  let url: URL;
  try {
    url = new URL(value);
  } catch (e) {
    throw new Error(invalid, { cause: e });
  }
  const loopback = LOOPBACK_HOSTNAMES.has(url.hostname);
  const scheme = url.protocol === "https:" || (url.protocol === "http:" && loopback);
  if (
    !scheme ||
    url.username !== "" ||
    url.password !== "" ||
    /[?#]/u.test(url.href) ||
    !(loopback || isCspSafeHostname(url.hostname))
  ) {
    throw new Error(invalid);
  }
  return url;
}

/** @throws {Error} when the server keyring configuration is missing or invalid. */
export function getServerEnvironment() {
  const currentKeyId = requireEnvironmentVariable("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID");
  if (!PASSPORT_KEY_ID_PATTERN.test(currentKeyId)) {
    throw new Error("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID is invalid.");
  }

  const keyringJson = requireEnvironmentVariable("PASSPORT_SERVER_SECRET_KEYRING_JSON");
  let keyring: unknown;
  try {
    keyring = JSON.parse(keyringJson);
  } catch {
    // Parser messages may echo the secret-bearing keyring, so do not retain the cause.
    throw new Error("PASSPORT_SERVER_SECRET_KEYRING_JSON must be valid JSON.");
  }
  if (keyring === null || typeof keyring !== "object" || Array.isArray(keyring)) {
    throw new Error("PASSPORT_SERVER_SECRET_KEYRING_JSON must be an object.");
  }

  const secrets = new Map<string, Buffer>();
  for (const [keyId, encoded] of Object.entries(keyring)) {
    if (!PASSPORT_KEY_ID_PATTERN.test(keyId) || typeof encoded !== "string") {
      throw new Error("Passport server keyring contains an invalid entry.");
    }
    const secret = decodeCanonicalBase64(encoded);
    if (secret === null || secret.byteLength < MINIMUM_SERVER_SECRET_BYTES) {
      throw new Error("Passport server keyring contains an invalid secret.");
    }
    secrets.set(keyId, secret);
  }

  if (!secrets.has(currentKeyId)) {
    throw new Error("Passport server keyring does not contain its current key ID.");
  }
  return { currentKeyId, secrets };
}

/** @throws {Error} naming only schema paths and issue codes, never configured values. */
function parsePassportProviderSettings(): PassportProviderSettings {
  const configuration = process.env.PASSPORT_PROVIDER_CONFIG_JSON?.trim() ?? "";
  let settings: unknown;
  try {
    settings = JSON.parse(configuration || "{}");
  } catch {
    // Parser messages quote the input, so do not retain the cause.
    throw new Error("PASSPORT_PROVIDER_CONFIG_JSON must be valid JSON.");
  }
  const parsed = passportProviderSchema.safeParse(settings);
  if (!parsed.success) {
    // Paths come from the strict schema; unknown keys are reported by code, not by name.
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.code}`,
    );
    throw new Error(`PASSPORT_PROVIDER_CONFIG_JSON is invalid (${issues.join("; ")}).`);
  }
  return parsed.data;
}

/**
 * Resolves the homeserver manual invites are prefilled with, storage offers are shown for, and
 * identities that do not remember theirs are republished to. There is no default: without
 * `PUBKY_SIGNUP_HOMESERVER` the instance has no provider homeserver.
 */
function parseProviderHomeserver(): string | null {
  const homeserver = process.env.PUBKY_SIGNUP_HOMESERVER?.trim();
  if (!homeserver) return null;
  if (!isCanonicalPubkyPublicKey(homeserver)) {
    throw new Error("PUBKY_SIGNUP_HOMESERVER must be a z-base-32 Pubky public key.");
  }
  return homeserver;
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function decodeCanonicalBase64(value: string): Buffer | null {
  const decoded = Buffer.from(value, "base64");
  // Node's decoder accepts URL-safe, unpadded, and whitespace-normalized aliases. The round trip
  // permits only the single canonical standard-Base64 representation for each configured secret.
  return decoded.toString("base64") === value ? decoded : null;
}

/**
 * Homegate's base: an HTTPS origin, or a path below one when Homegate is served under a prefix
 * (`https://gateway.example/homegate`); normalized with a trailing slash for relative API paths.
 */
function parseHomegateUrl(value: string): URL {
  const url = parseHttpsUrl(value, "HOMEGATE_URL", "url");
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return url;
}

/** An HTTPS URL whose host CSP can name, without credentials, query or fragment. */
function parseHttpsUrl(value: string, name: string, shape: "origin" | "url"): URL {
  const invalid = `${name} must be a valid HTTPS ${shape === "origin" ? "origin" : "URL"}.`;
  let url: URL;
  try {
    url = new URL(value);
  } catch (e) {
    throw new Error(invalid, { cause: e });
  }

  const usesHttps = url.protocol === "https:";
  const hasCredentials = url.username !== "" || url.password !== "";
  const containsOnlyShape =
    url.search === "" && url.hash === "" && (shape === "url" || url.pathname === "/");
  const hasSafeHostname = isCspSafeHostname(url.hostname);
  if (!usesHttps || hasCredentials || !containsOnlyShape || !hasSafeHostname) {
    throw new Error(invalid);
  }
  return url;
}
