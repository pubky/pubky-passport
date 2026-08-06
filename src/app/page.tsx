import { LOGGER } from "../libs/logger/logger";
import { getBrowserBootstrapConfig } from "../server/config/browserBootstrapConfig";
import { RootPageFlow } from "../ui/root/root-page-flow";

export default function Home() {
  let config: ReturnType<typeof getBrowserBootstrapConfig>;
  try {
    config = getBrowserBootstrapConfig();
  } catch {
    LOGGER.error("page.bootstrap.failed", { route: "home", layer: "page", operation: "bootstrap", stage: "configuration", code: "invalid_configuration" });
    throw new Error("Home page configuration unavailable.");
  }

  return <RootPageFlow googleClientId={config.googleClientId} homegateBaseUrl={config.homegateBaseUrl} />;
}
