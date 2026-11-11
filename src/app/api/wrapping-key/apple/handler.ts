import { AppleWrappingKeyIssuer } from "@/server/wrapping-key/apple/AppleWrappingKeyIssuer";
import { createWrappingKeyPost } from "../createWrappingKeyPost";

export const appleWrappingKeyPost = createWrappingKeyPost({
  provider: "apple",
  tokenField: "appleIdToken",
  createIssuer: () => AppleWrappingKeyIssuer.fromEnvironment(),
  statusForVerifierError: (code) => {
    switch (code) {
      case "invalid_apple_id_token":
        return 401;
      case "apple_verifier_unavailable":
        return 503;
    }
  },
});
