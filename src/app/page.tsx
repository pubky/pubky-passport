import { LOGGER } from "../libs/logger/logger";
import { getBrowserBootstrapConfig } from "../server/config/browserBootstrapConfig";
import { PassportApp } from "../ui/passport/passport-app";

export default function Home() {
  let config: ReturnType<typeof getBrowserBootstrapConfig>;
  try {
    config = getBrowserBootstrapConfig();
  } catch {
    LOGGER.error("page.bootstrap.failed", { route: "home", layer: "page", operation: "bootstrap", stage: "configuration", code: "invalid_configuration" });
    throw new Error("Home page configuration unavailable.");
  }

  return <PassportApp googleClientId={config.googleClientId} homegateBaseUrl={config.homegateBaseUrl} />;
}
