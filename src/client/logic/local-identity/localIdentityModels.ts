import "client-only";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import type { ProfileIdentity } from "@/client/logic/profile/profile";

/**
 * What this browser knows about encrypted backup files of a browser-held key, as ISO timestamps:
 * `createdAt` when Passport last made one, `verifiedAt` when one last opened with its password.
 * Passport never sees what the browser does with a file it made (the download may have been
 * cancelled), nor whether a checked file still exists. Every backup file of a key restores the
 * same key, so making a new file never erases an earlier check.
 */
export type LocalIdentityBackup = Readonly<{ createdAt?: string; verifiedAt?: string }>;

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
  }
>;

/** UI-safe local identity collection. Contains no secret key material. */
export type LocalIdentityCatalog = Readonly<{
  activePublicKeyZ32: string | null;
  identities: readonly LocalIdentityMetadata[];
}>;
