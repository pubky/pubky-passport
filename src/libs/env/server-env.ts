import "server-only";

import { parseGoogleWrappingKeyServerEnv, parseHomegateServerEnv } from "./server-env-parser";
import type { GoogleWrappingKeyServerEnv, HomegateServerEnv } from "./server-env-parser";

export type { GoogleWrappingKeyServerEnv, HomegateServerEnv } from "./server-env-parser";

export function getGoogleWrappingKeyServerEnv(): GoogleWrappingKeyServerEnv {
  return parseGoogleWrappingKeyServerEnv(process.env);
}

export function getHomegateServerEnv(): HomegateServerEnv {
  return parseHomegateServerEnv(process.env);
}
