import "server-only";

import { z } from "zod";

import { getGoogleClientId } from "./googleClientId";

const GOOGLE_CLIENT_SECRET_SCHEMA = z.string().trim().min(1, "GOOGLE_CLIENT_SECRET is required");

export type GoogleOAuthClientConfig = { clientId: string; clientSecret: string };

export function getGoogleOAuthClientConfig(): GoogleOAuthClientConfig {
  return {
    clientId: getGoogleClientId(),
    clientSecret: GOOGLE_CLIENT_SECRET_SCHEMA.parse(process.env.GOOGLE_CLIENT_SECRET),
  };
}
