import "server-only";

import { z } from "zod";

import { parseCspSafeHttpsOrigin } from "./cspSafeUrl";

const MAXIMUM_VALUE_CHARACTERS = 8_192;
const MAXIMUM_ORIGINS = 16;

export function getHomeserverConnectOrigins(): string[] {
  return z.string().trim().min(1, "PUBKY_HOMESERVER_CONNECT_ORIGINS is required")
    .transform((value, context) => {
      const origins = parseHomeserverConnectOrigins(value);
      if (origins) return origins;
      context.addIssue({
        code: "custom",
        message: "PUBKY_HOMESERVER_CONNECT_ORIGINS must contain CSP-safe HTTPS origins",
      });
      return z.NEVER;
    })
    .parse(process.env.PUBKY_HOMESERVER_CONNECT_ORIGINS);
}

function parseHomeserverConnectOrigins(value: string): string[] | null {
  if (value.length > MAXIMUM_VALUE_CHARACTERS) return null;
  const values = value.split(",").map((entry) => entry.trim());
  if (values.length > MAXIMUM_ORIGINS || values.some((entry) => entry.length === 0)) return null;

  const origins: string[] = [];
  for (const value of values) {
    const origin = parseCspSafeHttpsOrigin(value);
    if (!origin) return null;
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}
