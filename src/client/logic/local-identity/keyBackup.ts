import "client-only";

import type { LocalIdentityMetadata } from "./localIdentityModels";

/** The best backup file this browser knows of: one checked to open, else one Passport only made. */
export type KeyBackupFile = Readonly<{ verified: boolean; at: Date }>;

/**
 * How this identity's key could come back once this browser loses it, as far as this browser
 * knows: it lives in Pubky Ring, Google Drive holds an encrypted copy, a backup file exists, or
 * nothing is known. A backup file may have been lost since; Passport cannot see it.
 */
export type KeyBackup =
  | { kind: "ring" }
  | { kind: "google"; email: string }
  | ({ kind: "file" } & KeyBackupFile)
  | { kind: "none" };

export function keyBackupFile(identity: LocalIdentityMetadata): KeyBackupFile | undefined {
  if (identity.keySource === "ring" || !identity.backup) return undefined;
  const verifiedAt = parseDate(identity.backup.verifiedAt);
  if (verifiedAt) return { verified: true, at: verifiedAt };
  const createdAt = parseDate(identity.backup.createdAt);
  return createdAt ? { verified: false, at: createdAt } : undefined;
}

/** The strongest backup known for `identity`. Google restores by signing in, so it ranks first. */
export function keyBackup(identity: LocalIdentityMetadata): KeyBackup {
  if (identity.keySource === "ring") return { kind: "ring" };
  if (identity.googleAccount) return { kind: "google", email: identity.googleAccount.email };
  const file = keyBackupFile(identity);
  return file ? { kind: "file", ...file } : { kind: "none" };
}

/**
 * Whether something outside this browser is known to bring the key back: Pubky Ring, Google
 * Drive, or a backup file that opened with its password. A file Passport only made does not
 * count: the browser may never have saved it, and a mistyped password would lock it.
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
