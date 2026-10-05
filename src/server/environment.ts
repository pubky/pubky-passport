import "server-only";

import { isCspSafeHostname } from "@/libs/http/cspSafeHostname";
import { DEFAULT_PUBKY_HTTP_RELAY_URL, PASSPORT_KEY_ID_PATTERN } from "@/libs/passportPolicy";
import {
  passportProviderSchema,
  type PassportProvider,
  type PassportProviderSettings,
} from "@/libs/passportProvider";
import { isCanonicalPubkyPublicKey } from "@/libs/pubkyPublicKey";

const MINIMUM_SERVER_SECRET_BYTES = 32;

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
    ? parseHttpsOrigin(requireEnvironmentVariable("HOMEGATE_URL"), "HOMEGATE_URL")
    : null;

  const httpRelay = parseHttpsUrl(
    process.env.PUBKY_HTTP_RELAY_URL?.trim() || DEFAULT_PUBKY_HTTP_RELAY_URL,
    "PUBKY_HTTP_RELAY_URL",
    "url",
  );

  const instance: PassportProvider = {
    ...provider,
    features: { google },
    homeserver: parseProviderHomeserver(),
    httpRelay: httpRelay.href,
  };
  return {
    googleClientId,
    homegateBaseUrl: homegate?.href ?? "",
    /** `null` on an instance without Homegate, which then names no Homegate origin in CSP. */
    homegateOrigin: homegate?.origin ?? null,
    instance,
  };
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

function parseHttpsOrigin(value: string, name: string): URL {
  return parseHttpsUrl(value, name, "origin");
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
