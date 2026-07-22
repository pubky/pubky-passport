import type { PubkyPublicIdentity } from "./pubkyIdentity";

export const localIdentityStoreVersion = 1;

export type LocalIdentitySummary = {
  id: string;
  publicIdentity: PubkyPublicIdentity;
};

export type StoredLocalIdentity = LocalIdentitySummary & {
  secretKey: string;
};

export type LocalIdentityStoreV1 = {
  v: typeof localIdentityStoreVersion;
  activeIdentityId: string | null;
  identities: StoredLocalIdentity[];
};
