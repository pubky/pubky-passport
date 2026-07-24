import { getBrowserBootstrapConfig } from "../../server/config/browserBootstrapConfig";
import { AuthorizationReviewLoader } from "../../ui/authorizationReviewLoader";

export default function AuthorizePage() {
  const config = getBrowserBootstrapConfig();

  return (
    <AuthorizationReviewLoader
      googleClientId={config.googleClientId}
      homegateBaseUrl={config.homegateBaseUrl}
    />
  );
}
