import "server-only";

import { isCspSafeHostname } from "../libs/http/cspSafeHostname";
import { PASSPORT_KEY_ID_PATTERN } from "../libs/passportPolicy";

const MINIMUM_SERVER_SECRET_BYTES = 32;

/** @throws {Error} when required public configuration is missing or invalid. */
export function getPublicEnvironment() {
  const googleClientId = requireEnvironmentVariable("GOOGLE_CLIENT_ID");
  const homegate = parseHttpsOrigin(requireEnvironmentVariable("HOMEGATE_URL"), "HOMEGATE_URL");

  const homeserverConnectOrigins = [
    ...new Set(
      requireEnvironmentVariable("PUBKY_HOMESERVER_CONNECT_ORIGINS")
        .split(",")
        .map((value) => {
          const origin = parseHttpsOrigin(value.trim(), "PUBKY_HOMESERVER_CONNECT_ORIGINS");
          return origin.origin;
        }),
    ),
  ];

  return {
    googleClientId,
    homegateBaseUrl: homegate.href,
    homegateOrigin: homegate.origin,
    homeserverConnectOrigins,
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

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function decodeCanonicalBase64(value: string): Buffer | null {
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : null;
}

function parseHttpsOrigin(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (e) {
    throw new Error(`${name} must be a valid HTTPS origin.`, { cause: e });
  }

  const usesHttps = url.protocol === "https:";
  const hasCredentials = url.username !== "" || url.password !== "";
  const containsOnlyOrigin = url.pathname === "/" && url.search === "" && url.hash === "";
  const hasSafeHostname = isCspSafeHostname(url.hostname);
  if (!usesHttps || hasCredentials || !containsOnlyOrigin || !hasSafeHostname) {
    throw new Error(`${name} must be a valid HTTPS origin.`);
  }
  return url;
}
