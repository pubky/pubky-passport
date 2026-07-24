import "server-only";

import { parseGoogleWrappingKeyServerEnv } from "./server-env-parser";
import type { GoogleWrappingKeyServerEnv } from "./server-env-parser";

export function getGoogleWrappingKeyServerEnv(): GoogleWrappingKeyServerEnv {
  return parseGoogleWrappingKeyServerEnv(process.env);
}
