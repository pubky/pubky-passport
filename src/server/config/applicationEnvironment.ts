import "server-only";

import { z } from "zod";

import { isCspSafeHostname } from "../../libs/http/cspSafeHostname";

const MAXIMUM_HOMESERVER_ORIGINS_CHARACTERS = 8_192;
const MAXIMUM_HOMESERVER_ORIGINS = 16;
const MAXIMUM_URL_CHARACTERS = 2_048;
const MINIMUM_SERVER_SECRET_BYTES = 32;
const MAXIMUM_SERVER_SECRETS = 16;
const SERVER_SECRET_KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const APPLICATION_ENVIRONMENT_SCHEMA = z.object({
  GOOGLE_CLIENT_ID: z.string().trim().min(1, "GOOGLE_CLIENT_ID is required"),
  HOMEGATE_URL: z.string().trim().min(1, "HOMEGATE_URL is required")
    .transform((value, context) => {
      const homegate = parseHomegateUrl(value);
      if (homegate) return homegate;

      context.addIssue({
        code: "custom",
        message: "HOMEGATE_URL must be a CSP-safe HTTPS base URL",
      });
      return z.NEVER;
    }),
  PUBKY_HOMESERVER_CONNECT_ORIGINS: z.string().trim()
    .min(1, "PUBKY_HOMESERVER_CONNECT_ORIGINS is required")
    .transform((value, context) => {
      const origins = parseHomeserverConnectOrigins(value);
      if (origins) return origins;

      context.addIssue({
        code: "custom",
        message: "PUBKY_HOMESERVER_CONNECT_ORIGINS must contain CSP-safe HTTPS origins",
      });
      return z.NEVER;
    }),
  PASSPORT_SERVER_SECRET_CURRENT_KEY_ID: z.string().trim()
    .regex(SERVER_SECRET_KEY_ID_PATTERN, "PASSPORT_SERVER_SECRET_CURRENT_KEY_ID is invalid"),
  PASSPORT_SERVER_SECRET_KEYRING_JSON: z.string().trim().min(1),
});

export type ApplicationEnvironment = {
  googleClientId: string;
  homegateBaseUrl: string;
  homegateOrigin: string;
  homeserverConnectOrigins: string[];
  serverSecretCurrentKeyId: string;
  serverSecrets: ReadonlyMap<string, Buffer>;
}

export function getApplicationEnvironment(): ApplicationEnvironment {
  const environment = APPLICATION_ENVIRONMENT_SCHEMA.parse({
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    HOMEGATE_URL: process.env.HOMEGATE_URL,
    PUBKY_HOMESERVER_CONNECT_ORIGINS: process.env.PUBKY_HOMESERVER_CONNECT_ORIGINS,
    PASSPORT_SERVER_SECRET_CURRENT_KEY_ID: process.env.PASSPORT_SERVER_SECRET_CURRENT_KEY_ID,
    PASSPORT_SERVER_SECRET_KEYRING_JSON: process.env.PASSPORT_SERVER_SECRET_KEYRING_JSON,
  });

  const serverSecrets = parseServerSecrets(
    environment.PASSPORT_SERVER_SECRET_CURRENT_KEY_ID,
    environment.PASSPORT_SERVER_SECRET_KEYRING_JSON,
  );

  return {
    googleClientId: environment.GOOGLE_CLIENT_ID,
    homegateBaseUrl: environment.HOMEGATE_URL.baseUrl,
    homegateOrigin: environment.HOMEGATE_URL.origin,
    homeserverConnectOrigins: environment.PUBKY_HOMESERVER_CONNECT_ORIGINS,
    serverSecretCurrentKeyId: environment.PASSPORT_SERVER_SECRET_CURRENT_KEY_ID,
    serverSecrets,
  };
}

function parseServerSecrets(
  currentKeyId: string,
  keyringJson: string,
): ReadonlyMap<string, Buffer> {
  let rawKeyring: unknown;
  try {
    rawKeyring = JSON.parse(keyringJson);
  } catch {
    throw new Error("PASSPORT_SERVER_SECRET_KEYRING_JSON must be valid JSON.");
  }
  if (!isPlainObject(rawKeyring) || Object.keys(rawKeyring).length > MAXIMUM_SERVER_SECRETS) {
    throw new Error("PASSPORT_SERVER_SECRET_KEYRING_JSON must be a bounded object.");
  }

  const secrets = new Map<string, Buffer>();
  for (const [keyId, encodedSecret] of Object.entries(rawKeyring)) {
    if (!SERVER_SECRET_KEY_ID_PATTERN.test(keyId) || typeof encodedSecret !== "string") {
      throw new Error("Passport server keyring contains an invalid entry.");
    }
    const secret = decodeServerSecret(encodedSecret);
    if (!secret) throw new Error("Passport server keyring contains an invalid secret.");
    secrets.set(keyId, secret);
  }
  if (!secrets.has(currentKeyId)) {
    throw new Error("Passport server keyring does not contain its current key ID.");
  }

  return secrets;
}

function decodeServerSecret(value: string): Buffer | null {
  if (!BASE64_PATTERN.test(value)) return null;
  const secret = Buffer.from(value, "base64");
  return secret.byteLength >= MINIMUM_SERVER_SECRET_BYTES ? secret : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function parseHomegateUrl(value: string): { baseUrl: string; origin: string } | null {
  if (value.length > MAXIMUM_URL_CHARACTERS) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
    || !isCspSafeHostname(url.hostname)
  ) {
    return null;
  }

  url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  if (url.href.length > MAXIMUM_URL_CHARACTERS) return null;
  return { baseUrl: url.href, origin: url.origin };
}

function parseHomeserverConnectOrigins(value: string): string[] | null {
  if (value.length > MAXIMUM_HOMESERVER_ORIGINS_CHARACTERS) return null;
  const values = value.split(",").map((entry) => entry.trim());
  if (
    values.length > MAXIMUM_HOMESERVER_ORIGINS
    || values.some((entry) => entry.length === 0)
  ) {
    return null;
  }

  const origins: string[] = [];
  for (const value of values) {
    const origin = parseCspSafeHttpsOrigin(value);
    if (!origin) return null;
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

function parseCspSafeHttpsOrigin(value: string): string | null {
  if (value.length > MAXIMUM_URL_CHARACTERS) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
    || !isCspSafeHostname(url.hostname)
  ) {
    return null;
  }
  return url.origin;
}
