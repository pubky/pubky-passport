import { GoogleWrappingKeyIssuer } from "@/server/wrapping-key/google/GoogleWrappingKeyIssuer";
import { createWrappingKeyPost } from "../createWrappingKeyPost";

export const googleWrappingKeyPost = createWrappingKeyPost({
  provider: "google",
  tokenField: "googleIdToken",
  createIssuer: () => GoogleWrappingKeyIssuer.fromEnvironment(),
  statusForVerifierError: (code) => {
    switch (code) {
      case "invalid_google_id_token":
        return 401;
      case "google_verifier_unavailable":
        return 503;
    }
  },
});
