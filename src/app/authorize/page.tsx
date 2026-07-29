import { getBrowserBootstrapConfig } from "../../server/config/browserBootstrapConfig";
import { AUTHORIZATION_REVIEW_LOADER } from "../../ui/authorizationReviewLoader";

export default function AuthorizePage() {
  const config = getBrowserBootstrapConfig();

  return (
    <AUTHORIZATION_REVIEW_LOADER
      googleClientId={config.googleClientId}
      homegateBaseUrl={config.homegateBaseUrl}
    />
  );
}
