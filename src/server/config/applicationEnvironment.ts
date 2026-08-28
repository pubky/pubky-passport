import "server-only";

import { getPublicApplicationEnvironment } from "./publicApplicationEnvironment";
import { getServerSecretEnvironment } from "./serverSecretEnvironment";

export function validateApplicationEnvironment(): void {
  getPublicApplicationEnvironment();
  getServerSecretEnvironment();
}
