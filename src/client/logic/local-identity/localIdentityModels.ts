import "client-only";

import type { PubkyPublicIdentity } from "../pubky/pubkyIdentityKey";

/** Safe Google account metadata retained with a browser-local Pubky identity. */
export type GoogleAccountProfile = {
  id: string;
  email: string;
  name: string;
  pictureUrl: string | null;
};

/** UI-safe local identity metadata. Contains no secret key material. */
export type LocalIdentityMetadata = {
  publicIdentity: PubkyPublicIdentity;
  googleAccount?: GoogleAccountProfile;
};

/** UI-safe local identity collection. Contains no secret key material. */
export type LocalIdentityCatalog = {
  activePublicKeyZ32: string | null;
  identities: LocalIdentityMetadata[];
};
