import "server-only";

import { isCspSafeHostname } from "../libs/http/cspSafeHostname";
import { PASSPORT_KEY_ID_PATTERN } from "../libs/passportPolicy";

const MINIMUM_SERVER_SECRET_BYTES = 32;

/** @throws {Error} when required public configuration is missing or invalid. */
export function getPublicEnvironment() {
  const googleClientId = required("GOOGLE_CLIENT_ID");
  const homegate = httpsOrigin(required("HOMEGATE_URL"), "HOMEGATE_URL");

  const homeserverConnectOrigins = [
    ...new Set(
      required("PUBKY_HOMESERVER_CONNECT_ORIGINS")
        .split(",")
        .map((value) => {
          const origin = httpsOrigin(value.trim(), "PUBKY_HOMESERVER_CONNECT_ORIGINS");
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
  const currentKeyId = required("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID");
  if (!PASSPORT_KEY_ID_PATTERN.test(currentKeyId)) {
    throw new Error("PASSPORT_SERVER_SECRET_CURRENT_KEY_ID is invalid.");
  }

  const keyringJson = required("PASSPORT_SERVER_SECRET_KEYRING_JSON");
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
    const secret = Buffer.from(encoded, "base64");
    if (secret.byteLength < MINIMUM_SERVER_SECRET_BYTES || secret.toString("base64") !== encoded) {
      throw new Error("Passport server keyring contains an invalid secret.");
    }
    secrets.set(keyId, secret);
  }

  if (!secrets.has(currentKeyId)) {
    throw new Error("Passport server keyring does not contain its current key ID.");
  }
  return { currentKeyId, secrets };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function httpsOrigin(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (e) {
    throw new Error(`${name} must be a valid HTTPS origin.`, { cause: e });
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !isCspSafeHostname(url.hostname)
  ) {
    throw new Error(`${name} must be a valid HTTPS origin.`);
  }
  return url;
}
