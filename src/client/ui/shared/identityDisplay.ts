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

/**
 * The key of an identity without a profile name, for the avatar that stands in for its initials
 * (see `Avatar`); `undefined` once it has a name.
 */
export function unnamedKey(identity: DisplayedIdentity): string | undefined {
  return profileName(identity) ? undefined : identity.publicIdentity.publicKeyZ32;
}

/**
 * The colours an identity without a profile picture can get: nine hues 40° apart, each at two
 * lightness levels, so neighbours in a list look different at a glance (a continuous hue wheel
 * gives keys 30° apart the same brown). Each keeps white text at 4.5:1 or more.
 */
export const KEY_COLORS: readonly { hue: number; saturation: number; lightness: number }[] = [
  32, 24,
].flatMap((lightness) =>
  [0, 40, 80, 120, 160, 200, 240, 280, 320].map((hue) => ({ hue, saturation: 50, lightness })),
);

/**
 * A steady colour for a public key, as CSS, from {@link KEY_COLORS}, so an identity keeps the
 * same colour everywhere. FNV-1a, which spreads keys that share a prefix.
 */
export function keyColor(publicKeyZ32: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < publicKeyZ32.length; index++) {
    hash ^= publicKeyZ32.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const { hue, saturation, lightness } = KEY_COLORS[(hash >>> 0) % KEY_COLORS.length]!;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}
