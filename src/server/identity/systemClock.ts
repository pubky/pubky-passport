import "server-only";

import type { Clock } from "./wrappingKeyDependencies";

export const systemClock: Clock = {
  now() {
    return new Date();
  },
};
