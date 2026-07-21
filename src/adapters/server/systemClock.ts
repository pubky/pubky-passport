import "server-only";

import type { Clock } from "../../core/identity/dependencies/wrappingKey";

export const systemClock: Clock = {
  now() {
    return new Date();
  },
};
