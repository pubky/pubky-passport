import "server-only";

import { getApplicationEnvironment } from "./applicationEnvironment";

export function getBrowserBootstrapConfig() {
  const environment = getApplicationEnvironment();

  return {
    googleClientId: environment.googleClientId,
    homegateBaseUrl: environment.homegateBaseUrl,
    homegateOrigin: environment.homegateOrigin,
  };
}
