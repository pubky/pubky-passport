import "client-only";

import type { GoogleAccountProfile } from "../../../libs/googleAccountProfile";
import type { PubkyPublicIdentity } from "../pubky/pubkyIdentityKey";

export type { GoogleAccountProfile } from "../../../libs/googleAccountProfile";

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
