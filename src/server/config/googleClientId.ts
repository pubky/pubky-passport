import "server-only";

import { z } from "zod";

type EnvLike = Record<string, string | undefined>;

const googleClientIdSchema = z.string().trim().min(1, "GOOGLE_CLIENT_ID is required");

export function parseGoogleClientId(input: EnvLike): string {
  return googleClientIdSchema.parse(input.GOOGLE_CLIENT_ID);
}

export function getGoogleClientId(): string {
  return parseGoogleClientId(process.env);
}
