import "server-only";

import { parseGoogleWrappingKeyServerEnv, parseHomegateServerEnv } from "./server-parser";
import type { GoogleWrappingKeyServerEnv, HomegateServerEnv } from "./server-parser";

export type { GoogleWrappingKeyServerEnv, HomegateServerEnv } from "./server-parser";

export function getGoogleWrappingKeyServerEnv(): GoogleWrappingKeyServerEnv {
  return parseGoogleWrappingKeyServerEnv(process.env);
}

export function getHomegateServerEnv(): HomegateServerEnv {
  return parseHomegateServerEnv(process.env);
}
