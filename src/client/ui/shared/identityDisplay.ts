import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";

import { shortPublicKey } from "./formatPublicKey";

type DisplayedIdentity = Pick<LocalIdentityMetadata, "profile" | "publicIdentity">;

/** The identity's public profile name, or `undefined` while it has none (or none is known yet). */
export function profileName(identity: DisplayedIdentity): string | undefined {
  const name = identity.profile?.name.trim();
  return name ? name : undefined;
}

/**
 * What an identity is called wherever it is listed or confirmed: its profile name, or else a name
 * made from its own key, so two identities without a profile never read the same.
 */
export function identityDisplayName(identity: DisplayedIdentity): string {
  return profileName(identity) ?? `Pubky ${shortPublicKey(identity.publicIdentity.publicKeyZ32)}`;
}
