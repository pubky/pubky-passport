import "client-only";

import type { LocalIdentityMetadata } from "./localIdentityModels";

/** The best backup file this browser knows of: one checked to open, else one Passport only made. */
export type KeyBackupFile = Readonly<{ verified: boolean; at: Date }>;

/**
 * How this identity's key could come back once this browser loses it, as far as this browser
 * knows: it lives in Pubky Ring, Google Drive holds an encrypted copy, Pubky Ring was shown to
 * hold a copy (`ring-copy`), a backup file exists, or nothing is known. A backup file or Ring's
 * copy may have been lost since; Passport cannot see either.
 */
export type KeyBackup =
  | { kind: "ring" }
  | { kind: "google"; email: string }
  | { kind: "ring-copy"; at: Date }
  | ({ kind: "file" } & KeyBackupFile)
  | { kind: "none" };

/** A check that a backup of this key restores it: a file opened, or Pubky Ring signed with it. */
export type BackupVerification = Readonly<{ method: "file" | "ring"; at: Date }>;

export function keyBackupFile(identity: LocalIdentityMetadata): KeyBackupFile | undefined {
  if (identity.keySource === "ring" || !identity.backup) return undefined;
  const verifiedAt = parseDate(identity.backup.verifiedAt);
  if (verifiedAt) return { verified: true, at: verifiedAt };
  const createdAt = parseDate(identity.backup.createdAt);
  return createdAt ? { verified: false, at: createdAt } : undefined;
}

/** When Pubky Ring last approved a sign-in with this browser-held key, if it ever did. */
export function ringVerification(identity: LocalIdentityMetadata): Date | undefined {
  if (identity.keySource === "ring") return undefined;
  return parseDate(identity.backup?.ringVerifiedAt);
}

/** The most recent check of a backup of this key, of either kind. */
export function latestBackupVerification(
  identity: LocalIdentityMetadata,
): BackupVerification | undefined {
  const file = keyBackupFile(identity);
  const fileAt = file?.verified ? file.at : undefined;
  const ringAt = ringVerification(identity);
  if (ringAt && (!fileAt || ringAt.getTime() >= fileAt.getTime()))
    return { method: "ring", at: ringAt };
  return fileAt ? { method: "file", at: fileAt } : undefined;
}

/**
 * The strongest backup known for `identity`. Google restores by signing in, so it ranks first;
 * between a checked file and Pubky Ring's copy, the one checked last.
 */
export function keyBackup(identity: LocalIdentityMetadata): KeyBackup {
  if (identity.keySource === "ring") return { kind: "ring" };
  if (identity.googleAccount) return { kind: "google", email: identity.googleAccount.email };
  const verification = latestBackupVerification(identity);
  if (verification?.method === "ring") return { kind: "ring-copy", at: verification.at };
  const file = keyBackupFile(identity);
  return file ? { kind: "file", ...file } : { kind: "none" };
}

/**
 * Whether something outside this browser is known to bring the key back: Pubky Ring, Google
 * Drive, a backup file that opened with its password, or a copy Pubky Ring signed with. A file
 * Passport only made does not count: the browser may never have saved it, and a mistyped password
 * would lock it.
 */
export function isKeyProtected(identity: LocalIdentityMetadata): boolean {
  const backup = keyBackup(identity);
  return backup.kind === "file" ? backup.verified : backup.kind !== "none";
}

function parseDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
