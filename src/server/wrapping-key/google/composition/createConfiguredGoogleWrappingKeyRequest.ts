import "server-only";

import { getGoogleClientId } from "../../../config/googleClientId";
import { GoogleWrappingKeyDeriver } from "../adapters/googleWrappingKeyDeriver";
import { GoogleIdTokenVerifier } from "../adapters/googleIdTokenVerifier";
import { InMemoryGoogleWrappingKeyRateLimiter } from "../adapters/inMemoryGoogleWrappingKeyRateLimiter";
import { GoogleWrappingKeyRequest } from "../application/googleWrappingKeyRequest";
import { parseGoogleWrappingKeyServerSecret } from "./googleWrappingKeyServerSecret";

export function createConfiguredGoogleWrappingKeyRequest(): GoogleWrappingKeyRequest {
  const serverSecret = parseGoogleWrappingKeyServerSecret(process.env);

  try {
    const googleIdTokenVerifier = new GoogleIdTokenVerifier({ audience: getGoogleClientId() });

    return new GoogleWrappingKeyRequest({
      googleIdTokenVerifier,
      rateLimiter: new InMemoryGoogleWrappingKeyRateLimiter({ identityPepper: serverSecret }),
      deriver: new GoogleWrappingKeyDeriver(serverSecret),
    });
  } finally {
    serverSecret.fill(0);
  }
}
