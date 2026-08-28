import "server-only";

import { getPublicApplicationEnvironment } from "./publicApplicationEnvironment";

export function getBrowserBootstrapConfig() {
  const environment = getPublicApplicationEnvironment();

  return {
    googleClientId: environment.googleClientId,
    homegateBaseUrl: environment.homegateBaseUrl,
    homegateOrigin: environment.homegateOrigin,
  };
}
