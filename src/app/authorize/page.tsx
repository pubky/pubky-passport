import { publicEnv } from "../../libs/env/public-env";
import { AuthorizationReviewLoader } from "../../ui/authorizationReviewLoader";

export default function AuthorizePage() {
  return (
    <AuthorizationReviewLoader
      allowLocalhostRelay={process.env.NODE_ENV === "development"}
      allowLocalhostCallbacks={process.env.NODE_ENV === "development"}
      pubkyTestnetHost={publicEnv.NEXT_PUBLIC_PUBKY_TESTNET_HOST}
      relayOrigin={new URL(publicEnv.NEXT_PUBLIC_HTTP_RELAY_URL).origin}
    />
  );
}
