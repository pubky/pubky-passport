import "server-only";

import { parseHomegateInviteServerEnv, parseServerEnv } from "./server-parser";
import type { HomegateInviteServerEnv, ServerEnv } from "./server-parser";

export type { HomegateInviteServerEnv, ServerEnv } from "./server-parser";

export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}

export function getHomegateInviteServerEnv(): HomegateInviteServerEnv {
  return parseHomegateInviteServerEnv(process.env);
}
