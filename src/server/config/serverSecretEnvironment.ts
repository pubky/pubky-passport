import "server-only";

import { z } from "zod";

import { PASSPORT_KEY_ID_PATTERN, passportKeyIdSchema } from "../../libs/passportPolicy";

const MINIMUM_SERVER_SECRET_BYTES = 32;
const MAXIMUM_SERVER_SECRET_BYTES = 64;
const MAXIMUM_SERVER_SECRET_KEYRING_BYTES = 512;
const MAXIMUM_SERVER_SECRETS = 16;
const MAXIMUM_ENCODED_SERVER_SECRET_CHARACTERS = Math.ceil(MAXIMUM_SERVER_SECRET_BYTES / 3) * 4;
const MAXIMUM_SERVER_SECRET_KEYRING_JSON_CHARACTERS = 2_048;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const SERVER_SECRET_ENVIRONMENT_SCHEMA = z.object({
  PASSPORT_SERVER_SECRET_CURRENT_KEY_ID: passportKeyIdSchema,
  PASSPORT_SERVER_SECRET_KEYRING_JSON: z.string().trim().min(1),
});

export type ServerSecretEnvironment = {
  serverSecretCurrentKeyId: string;
  serverSecrets: ReadonlyMap<string, Buffer>;
}

type ServerSecretEnvironmentSources = readonly [
  currentKeyId: string | undefined,
  keyringJson: string | undefined,
];

let cachedEnvironment: {
  sources: ServerSecretEnvironmentSources;
  value: ServerSecretEnvironment;
} | undefined;

export function getServerSecretEnvironment(): ServerSecretEnvironment {
  const sources: ServerSecretEnvironmentSources = [
    process.env.PASSPORT_SERVER_SECRET_CURRENT_KEY_ID,
    process.env.PASSPORT_SERVER_SECRET_KEYRING_JSON,
  ];
  if (cachedEnvironment && sourcesEqual(cachedEnvironment.sources, sources)) {
    return cachedEnvironment.value;
  }

  const environment = SERVER_SECRET_ENVIRONMENT_SCHEMA.parse({
    PASSPORT_SERVER_SECRET_CURRENT_KEY_ID: sources[0],
    PASSPORT_SERVER_SECRET_KEYRING_JSON: sources[1],
  });
  const value: ServerSecretEnvironment = {
    serverSecretCurrentKeyId: environment.PASSPORT_SERVER_SECRET_CURRENT_KEY_ID,
    serverSecrets: parseServerSecrets(
      environment.PASSPORT_SERVER_SECRET_CURRENT_KEY_ID,
      environment.PASSPORT_SERVER_SECRET_KEYRING_JSON,
    ),
  };
  cachedEnvironment = { sources, value };
  return value;
}

function sourcesEqual(
  cached: ServerSecretEnvironmentSources,
  current: ServerSecretEnvironmentSources,
): boolean {
  return cached.every((value, index) => value === current[index]);
}

function parseServerSecrets(
  currentKeyId: string,
  keyringJson: string,
): ReadonlyMap<string, Buffer> {
  if (keyringJson.length > MAXIMUM_SERVER_SECRET_KEYRING_JSON_CHARACTERS) {
    throw new Error("PASSPORT_SERVER_SECRET_KEYRING_JSON exceeds its maximum size.");
  }

  let rawKeyring: unknown;
  try {
    rawKeyring = JSON.parse(keyringJson);
  } catch {
    throw new Error("PASSPORT_SERVER_SECRET_KEYRING_JSON must be valid JSON.");
  }
  if (!isPlainObject(rawKeyring) || Object.keys(rawKeyring).length > MAXIMUM_SERVER_SECRETS) {
    throw new Error("PASSPORT_SERVER_SECRET_KEYRING_JSON must be a bounded object.");
  }

  let totalSecretBytes = 0;
  const secrets = new Map<string, Buffer>();
  for (const [keyId, encodedSecret] of Object.entries(rawKeyring)) {
    if (!PASSPORT_KEY_ID_PATTERN.test(keyId) || typeof encodedSecret !== "string") {
      throw new Error("Passport server keyring contains an invalid entry.");
    }
    const secret = decodeServerSecret(encodedSecret);
    if (!secret) throw new Error("Passport server keyring contains an invalid secret.");
    totalSecretBytes += secret.byteLength;
    if (totalSecretBytes > MAXIMUM_SERVER_SECRET_KEYRING_BYTES) {
      throw new Error("Passport server keyring exceeds its maximum decoded size.");
    }
    secrets.set(keyId, secret);
  }
  if (!secrets.has(currentKeyId)) {
    throw new Error("Passport server keyring does not contain its current key ID.");
  }

  return secrets;
}

function decodeServerSecret(value: string): Buffer | null {
  if (value.length > MAXIMUM_ENCODED_SERVER_SECRET_CHARACTERS || !BASE64_PATTERN.test(value)) {
    return null;
  }
  const secret = Buffer.from(value, "base64");
  return secret.byteLength >= MINIMUM_SERVER_SECRET_BYTES
    && secret.byteLength <= MAXIMUM_SERVER_SECRET_BYTES
    ? secret
    : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
