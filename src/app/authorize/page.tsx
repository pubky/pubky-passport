import { LOGGER } from "../../libs/logger/logger";
import { getBrowserBootstrapConfig } from "../../server/config/browserBootstrapConfig";
import { AuthorizationFlow } from "../../client/ui/authorization/authorizationFlow";

export default function AuthorizePage() {
  let config: ReturnType<typeof getBrowserBootstrapConfig>;
  try {
    config = getBrowserBootstrapConfig();
  } catch {
    LOGGER.error("page.bootstrap.failed", {
      route: "authorize",
      layer: "page",
      operation: "bootstrap",
      stage: "configuration",
      code: "invalid_configuration",
    });
    throw new Error("Authorization page configuration unavailable.");
  }

  return <AuthorizationFlow
    googleClientId={config.googleClientId}
    homegateBaseUrl={config.homegateBaseUrl}
  />;
}
