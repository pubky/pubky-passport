import { publicEnv } from "../../libs/env/public-env";
import { AuthorizationReviewLoader } from "../../ui/authorizationReviewLoader";

export default function AuthorizePage() {
  return (
    <AuthorizationReviewLoader
      relayOrigin={new URL(publicEnv.NEXT_PUBLIC_HTTP_RELAY_URL).origin}
    />
  );
}
