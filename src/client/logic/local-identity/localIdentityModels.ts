import "client-only";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import type { ProfileIdentity } from "@/client/logic/profile/profile";

/**
 * What this browser knows about backups of a browser-held key, as ISO timestamps: `createdAt` when
 * Passport last made an encrypted backup file, `verifiedAt` when one last opened with its
 * password, `ringVerifiedAt` when Pubky Ring last approved a sign-in with this key (so it holds a
 * copy). Passport never sees what the browser does with a file it made (the download may have
 * been cancelled), nor whether a checked file or Ring's copy still exists. Every backup of a key
 * restores the same key, so making a new file never erases an earlier check.
 */
export type LocalIdentityBackup = Readonly<{
  createdAt?: string;
  verifiedAt?: string;
  ringVerifiedAt?: string;
}>;

/**
 * The public name and a small copy of the avatar this browser last read for an identity. Lists
 * show it instead of reading every saved identity's profile at once, which would let PKARR relays
 * and shared homeservers link identities kept apart. `avatar` is a `data:` URL.
 */
export type ProfileSummary = Readonly<{ name: string; avatar?: string }>;

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
    /** Backup files of a browser-held key; absent when this browser knows of none. */
    backup?: LocalIdentityBackup;
    /** The profile last read in this browser, if any; see {@link ProfileSummary}. */
    profileSummary?: ProfileSummary;
  }
>;

/** UI-safe local identity collection. Contains no secret key material. */
export type LocalIdentityCatalog = Readonly<{
  activePublicKeyZ32: string | null;
  identities: readonly LocalIdentityMetadata[];
}>;
