import "client-only";

import { Result } from "better-result";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { parseGoogleAuthorizationResponse } from "./parseGoogleAuthorizationResponse";
import { fetchGoogleAccountProfile } from "./fetchGoogleAccountProfile";
import type {
  GoogleIdentityCredentials,
  GoogleImplicitAuthorizationResult,
} from "./GoogleImplicitAuthorization";

/**
 * Shared validation for popup and same-tab responses; tokens never enter storage or UI state. The
 * ID token must carry `nonce`, the hash of `noncePreimage`, which the credentials keep for
 * Passport's own wrapping-key endpoint.
 */
export async function resolveGoogleCredentials(
  capture: unknown,
  state: string,
  nonce: string,
  noncePreimage: string,
  signal: AbortSignal,
): Promise<GoogleImplicitAuthorizationResult<GoogleIdentityCredentials>> {
  const parsed = parseGoogleAuthorizationResponse(capture, state, nonce);
  if (Result.isError(parsed)) {
    LOGGER.warn("identity.google.implicit_authorization.failed", {
      operation: "authorize",
      stage: "response",
      code: parsed.error.code,
    });
    return Result.err(parsed.error);
  }
  const account = await fetchGoogleAccountProfile(
    parsed.value.accessToken,
    parsed.value.googleSubject,
    signal,
  );
  if (Result.isError(account)) {
    LOGGER.warn("identity.google.implicit_authorization.failed", {
      operation: "authorize",
      stage: account.error.stage,
      ...(account.error.httpStatus === undefined ? {} : { httpStatus: account.error.httpStatus }),
      ...(account.error.cause === undefined ? {} : safeErrorLogFields(account.error.cause)),
      code: account.error.code,
    });
    return Result.err({
      code: account.error.code,
      ...(account.error.cause === undefined ? {} : { cause: account.error.cause }),
    });
  }
  return Result.ok({
    googleIdToken: parsed.value.googleIdToken,
    googleNoncePreimage: noncePreimage,
    driveAccessToken: parsed.value.accessToken,
    driveAccessTokenExpiresAt: parsed.value.accessTokenExpiresAt,
    googleAccount: account.value,
    visibleBackupPermissionGranted: parsed.value.visibleBackupPermissionGranted,
  });
}
