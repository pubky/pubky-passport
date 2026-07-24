import { publicEnv } from "../../libs/env/public-env";
import { AuthorizationReviewLoader } from "../../ui/authorizationReviewLoader";

export default function AuthorizePage() {
  return (
    <AuthorizationReviewLoader
      googleClientId={publicEnv.NEXT_PUBLIC_GOOGLE_CLIENT_ID}
      homegateBaseUrl={publicEnv.NEXT_PUBLIC_HOMEGATE_URL}
      passportUrl={publicEnv.NEXT_PUBLIC_PASSPORT_PUBLIC_URL}
    />
  );
}
