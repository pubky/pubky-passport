import "server-only";

import { z } from "zod";

import { MAXIMUM_URL_CHARACTERS } from "../../libs/passportPolicy";

import { isCspSafeHostname } from "../../libs/http/cspSafeHostname";

const MAXIMUM_HOMESERVER_ORIGINS_CHARACTERS = 8_192;
const MAXIMUM_HOMESERVER_ORIGINS = 16;

const PUBLIC_APPLICATION_ENVIRONMENT_SCHEMA = z.object({
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
});

export type PublicApplicationEnvironment = {
  googleClientId: string;
  homegateBaseUrl: string;
  homegateOrigin: string;
  homeserverConnectOrigins: readonly string[];
}

type PublicEnvironmentSources = readonly [
  googleClientId: string | undefined,
  homegateUrl: string | undefined,
  homeserverConnectOrigins: string | undefined,
];

let cachedEnvironment: {
  sources: PublicEnvironmentSources;
  value: PublicApplicationEnvironment;
} | undefined;

export function getPublicApplicationEnvironment(): PublicApplicationEnvironment {
  const sources: PublicEnvironmentSources = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.HOMEGATE_URL,
    process.env.PUBKY_HOMESERVER_CONNECT_ORIGINS,
  ];
  if (cachedEnvironment && sourcesEqual(cachedEnvironment.sources, sources)) {
    return cachedEnvironment.value;
  }

  const environment = PUBLIC_APPLICATION_ENVIRONMENT_SCHEMA.parse({
    GOOGLE_CLIENT_ID: sources[0],
    HOMEGATE_URL: sources[1],
    PUBKY_HOMESERVER_CONNECT_ORIGINS: sources[2],
  });
  const value: PublicApplicationEnvironment = {
    googleClientId: environment.GOOGLE_CLIENT_ID,
    homegateBaseUrl: environment.HOMEGATE_URL.baseUrl,
    homegateOrigin: environment.HOMEGATE_URL.origin,
    homeserverConnectOrigins: Object.freeze(environment.PUBKY_HOMESERVER_CONNECT_ORIGINS),
  };
  cachedEnvironment = { sources, value };
  return value;
}

function sourcesEqual(cached: PublicEnvironmentSources, current: PublicEnvironmentSources): boolean {
  return cached.every((value, index) => value === current[index]);
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
