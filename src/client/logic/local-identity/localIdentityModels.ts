import "client-only";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";

/** UI-safe local identity metadata. Contains no secret key material. */
export type LocalIdentityMetadata = Readonly<{
  publicIdentity: PubkyPublicIdentity;
  googleAccount?: GoogleAccountProfile;
}>;

/** UI-safe local identity collection. Contains no secret key material. */
export type LocalIdentityCatalog = Readonly<{
  activePublicKeyZ32: string | null;
  identities: readonly LocalIdentityMetadata[];
}>;

/** The sign-in account that unlocks an identity's encrypted Passport file. */
export type IdentityProviderAccount = Readonly<{
  provider: "google";
  googleAccount: GoogleAccountProfile;
}>;

/** Returns the provider account an identity was created or restored with, if any. */
export function identityProviderAccount(
  identity: LocalIdentityMetadata,
): IdentityProviderAccount | undefined {
  if (identity.googleAccount) return { provider: "google", googleAccount: identity.googleAccount };
  return undefined;
}
