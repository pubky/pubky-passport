import { parsePublicEnv } from "./public-env-parser";

export type { PublicEnv } from "./public-env-parser";

export const publicEnv = parsePublicEnv({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_PASSPORT_PUBLIC_URL: process.env.NEXT_PUBLIC_PASSPORT_PUBLIC_URL,
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
});
