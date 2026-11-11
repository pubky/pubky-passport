import "server-only";

import { Result } from "better-result";

import { getPublicEnvironment, getServerEnvironment } from "@/server/environment";
import { WrappingKeyIssuer, type WrappingKeyIssueErrorCode } from "../WrappingKeyIssuer";
import { GoogleIdTokenVerifier } from "./GoogleIdTokenVerifier";

export type GoogleWrappingKeyIssueErrorCode = WrappingKeyIssueErrorCode<
  "google_verifier_unavailable" | "invalid_google_id_token"
>;

/** Wrapping-key issuer for Google ID tokens. */
export class GoogleWrappingKeyIssuer extends WrappingKeyIssuer<
  "google_verifier_unavailable" | "invalid_google_id_token"
> {
  /**
   * @param googleClientId Audience required in every accepted Google ID token.
   * @param currentKeyId Key ID used when creating a new Passport file.
   * @param secrets Server secrets indexed by the public key IDs stored in Passport envelopes.
   */
  constructor(googleClientId: string, currentKeyId: string, secrets: ReadonlyMap<string, Buffer>) {
    const verifier = new GoogleIdTokenVerifier(googleClientId);
    super(
      "google",
      {
        verifyIdToken: async (idToken) => {
          const verified = await verifier.verifyGoogleIdToken(idToken);
          if (Result.isError(verified)) return Result.err(verified.error);
          return Result.ok({
            provider: "google",
            issuer: verified.value.issuer,
            subject: verified.value.googleSubject,
          });
        },
      },
      "google_verifier_unavailable",
      currentKeyId,
      secrets,
    );
  }

  /** @throws {Error} when required server configuration is missing or invalid. */
  static fromEnvironment(): GoogleWrappingKeyIssuer {
    const { googleClientId } = getPublicEnvironment();
    const { currentKeyId, secrets } = getServerEnvironment();
    return new GoogleWrappingKeyIssuer(googleClientId, currentKeyId, secrets);
  }
}
