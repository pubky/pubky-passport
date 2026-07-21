import "server-only";

import { createRequestWrappingKeyUseCase } from "./requestWrappingKey";
import { createRequestGoogleWrappingKeyController } from "./requestGoogleWrappingKeyController";
import { systemClock } from "./systemClock";
import { getServerEnv } from "../../libs/env/server";
import { createGoogleAuthLibraryIdTokenVerifier } from "./google/googleIdTokenVerifier";
import { createInMemoryWrappingKeyRateLimiter } from "./rateLimit/inMemoryWrappingKeyRateLimiter";
import { createServerWrappingKeyDeriver } from "./secrets/wrappingKeyDeriver";

export function createWrappingKeyRequestController() {
  const env = getServerEnv();

  return createRequestGoogleWrappingKeyController(
    createRequestWrappingKeyUseCase({
      providerIdTokenVerifier: createGoogleAuthLibraryIdTokenVerifier({ audience: env.GOOGLE_CLIENT_ID }),
      wrappingKeyDeriver: createServerWrappingKeyDeriver({
        serverSecretBase64: env.PASSPORT_SERVER_SECRET_BASE64,
      }),
      wrappingKeyRateLimiter: createInMemoryWrappingKeyRateLimiter({
        serverSecretBase64: env.PASSPORT_SERVER_SECRET_BASE64,
      }),
      clock: systemClock,
    }),
  );
}
