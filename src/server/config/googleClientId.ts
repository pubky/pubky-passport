import "server-only";

import { z } from "zod";

type EnvLike = Record<string, string | undefined>;

const GOOGLE_CLIENT_ID_SCHEMA = z.string().trim().min(1, "GOOGLE_CLIENT_ID is required");

export function parseGoogleClientId(input: EnvLike): string {
  return GOOGLE_CLIENT_ID_SCHEMA.parse(input.GOOGLE_CLIENT_ID);
}

export function getGoogleClientId(): string {
  return parseGoogleClientId(process.env);
}
