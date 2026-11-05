import "server-only";

import { getAppleEnvironment, getServerEnvironment } from "@/server/environment";
import { WrappingKeyIssuer } from "../WrappingKeyIssuer";
import { AppleIdTokenVerifier } from "./AppleIdTokenVerifier";

/** Wrapping-key issuer for Sign in with Apple ID tokens. */
export class AppleWrappingKeyIssuer extends WrappingKeyIssuer<
  "apple_verifier_unavailable" | "invalid_apple_id_token"
> {
  /**
   * @param servicesId Audience required in every accepted Apple ID token.
   * @param currentKeyId Key ID used when creating a new Passport file.
   * @param secrets Server secrets indexed by the public key IDs stored in Passport envelopes.
   * @param verifier Replaces the default verifier in tests.
   */
  constructor(
    servicesId: string,
    currentKeyId: string,
    secrets: ReadonlyMap<string, Buffer>,
    verifier: Pick<AppleIdTokenVerifier, "verifyIdToken"> = new AppleIdTokenVerifier(servicesId),
  ) {
    super("apple", verifier, "apple_verifier_unavailable", currentKeyId, secrets);
  }

  /**
   * @returns `null` when Apple login is off.
   * @throws {Error} when required server configuration is missing or invalid.
   */
  static fromEnvironment(): AppleWrappingKeyIssuer | null {
    const apple = getAppleEnvironment();
    if (!apple) return null;
    const { currentKeyId, secrets } = getServerEnvironment();
    return new AppleWrappingKeyIssuer(apple.servicesId, currentKeyId, secrets);
  }
}
