import "client-only";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import type { ProfileIdentity } from "@/client/logic/profile/profile";

/** UI-safe local identity metadata. Contains no secret key material. */
export type LocalIdentityMetadata = Readonly<
  ProfileIdentity & {
    publicIdentity: PubkyPublicIdentity;
    /** External identities retain public metadata only; their private key stays in Ring. */
    keySource?: "ring";
    googleAccount?: GoogleAccountProfile;
    /** Homeserver this browser signed the key up on; absent for imported and older records. */
    homeserverPubky?: string;
    /** A registered account stays in onboarding until its public profile is saved. */
    profileSetupRequired?: true;
  }
>;

/** UI-safe local identity collection. Contains no secret key material. */
export type LocalIdentityCatalog = Readonly<{
  activePublicKeyZ32: string | null;
  identities: readonly LocalIdentityMetadata[];
}>;
