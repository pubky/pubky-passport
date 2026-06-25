import "server-only";

import { parseServerEnv } from "./server-parser";

export type { ServerEnv } from "./server-parser";

export const serverEnv = parseServerEnv(process.env);
