import "client-only";

import type { AppleAccount } from "@/libs/appleAccount";
import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";

/** UI-safe local identity metadata. Contains no secret key material. */
export type LocalIdentityMetadata = Readonly<{
  publicIdentity: PubkyPublicIdentity;
  googleAccount?: GoogleAccountProfile;
  appleAccount?: AppleAccount;
}>;

/** UI-safe local identity collection. Contains no secret key material. */
export type LocalIdentityCatalog = Readonly<{
  activePublicKeyZ32: string | null;
  identities: readonly LocalIdentityMetadata[];
}>;

/** The sign-in account that unlocks an identity's encrypted Passport file. */
export type IdentityProviderAccount =
  | Readonly<{ provider: "google"; googleAccount: GoogleAccountProfile }>
  | Readonly<{ provider: "apple"; appleAccount: AppleAccount }>;

/** Returns the provider account an identity was created or restored with, if any. */
export function identityProviderAccount(
  identity: LocalIdentityMetadata,
): IdentityProviderAccount | undefined {
  if (identity.googleAccount) return { provider: "google", googleAccount: identity.googleAccount };
  if (identity.appleAccount) return { provider: "apple", appleAccount: identity.appleAccount };
  return undefined;
}

/** What the UI shows for an identity's sign-in account. Apple has no profile picture. */
export type IdentityProfile = Readonly<{
  name: string | null;
  email: string | null;
  pictureUrl: string | null;
}>;

export function identityProfile(
  identity: LocalIdentityMetadata | null | undefined,
): IdentityProfile {
  if (identity?.googleAccount) {
    const { email, name, pictureUrl } = identity.googleAccount;
    return { name, email, pictureUrl };
  }
  if (identity?.appleAccount) {
    const { email, name } = identity.appleAccount;
    return { name, email, pictureUrl: null };
  }
  return { name: null, email: null, pictureUrl: null };
}
