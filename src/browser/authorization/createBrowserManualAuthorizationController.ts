import "client-only";

import type { BrowserManualAuthorizationController } from "./browserManualAuthorizationController";
import { PassportManualAuthorizationController } from "./passportManualAuthorizationController";

export function createBrowserManualAuthorizationController(): BrowserManualAuthorizationController {
  return new PassportManualAuthorizationController((url) => window.location.replace(url));
}
