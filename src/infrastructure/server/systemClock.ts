import "server-only";

import type { Clock } from "../../core/ports/clock";

export const systemClock: Clock = {
  now() {
    return new Date();
  },
};
