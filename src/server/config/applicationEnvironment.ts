import "server-only";

import { z } from "zod";

import { isCspSafeHostname } from "../../libs/http/cspSafeHostname";

const MAXIMUM_HOMESERVER_ORIGINS_CHARACTERS = 8_192;
const MAXIMUM_HOMESERVER_ORIGINS = 16;
const MAXIMUM_URL_CHARACTERS = 2_048;
const MINIMUM_SERVER_SECRET_BYTES = 32;
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
  PASSPORT_SERVER_SECRET_BASE64: z.string().trim()
    .regex(BASE64_PATTERN, "PASSPORT_SERVER_SECRET_BASE64 must be valid base64")
    .transform((value) => Buffer.from(value, "base64"))
    .refine(
      (value) => value.byteLength >= MINIMUM_SERVER_SECRET_BYTES,
      `PASSPORT_SERVER_SECRET_BASE64 must decode to at least ${MINIMUM_SERVER_SECRET_BYTES} bytes`,
    ),
});

export type ApplicationEnvironment = {
  googleClientId: string;
  homegateBaseUrl: string;
  homegateOrigin: string;
  homeserverConnectOrigins: string[];
  serverSecret: Buffer;
}

export function getApplicationEnvironment(): ApplicationEnvironment {
  const environment = APPLICATION_ENVIRONMENT_SCHEMA.parse({
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    HOMEGATE_URL: process.env.HOMEGATE_URL,
    PUBKY_HOMESERVER_CONNECT_ORIGINS: process.env.PUBKY_HOMESERVER_CONNECT_ORIGINS,
    PASSPORT_SERVER_SECRET_BASE64: process.env.PASSPORT_SERVER_SECRET_BASE64,
  });

  return {
    googleClientId: environment.GOOGLE_CLIENT_ID,
    homegateBaseUrl: environment.HOMEGATE_URL.baseUrl,
    homegateOrigin: environment.HOMEGATE_URL.origin,
    homeserverConnectOrigins: environment.PUBKY_HOMESERVER_CONNECT_ORIGINS,
    serverSecret: environment.PASSPORT_SERVER_SECRET_BASE64,
  };
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
