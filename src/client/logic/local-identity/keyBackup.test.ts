import { describe, expect, it } from "vitest";

import {
  isKeyProtected,
  keyBackup,
  keyBackupFile,
  latestBackupVerification,
  ringVerification,
} from "./keyBackup";

const PUBLIC_IDENTITY = { publicKeyZ32: "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy" };
const GOOGLE_ACCOUNT = {
  googleSubject: "subject",
  email: "person@example.com",
  name: "Person",
  pictureUrl: null,
};
const AT = "2026-09-01T10:00:00.000Z";
const LATER = "2026-09-02T10:00:00.000Z";

describe("keyBackup", () => {
  it("reports a Ring-held key as living in Ring", () => {
    const identity = { publicIdentity: PUBLIC_IDENTITY, keySource: "ring" as const };
    expect(keyBackup(identity)).toEqual({ kind: "ring" });
    expect(isKeyProtected(identity)).toBe(true);
  });

  it("ranks a Google Drive copy above a backup file", () => {
    const identity = {
      publicIdentity: PUBLIC_IDENTITY,
      googleAccount: GOOGLE_ACCOUNT,
      backup: { createdAt: AT },
    };
    expect(keyBackup(identity)).toEqual({ kind: "google", email: "person@example.com" });
    expect(isKeyProtected(identity)).toBe(true);
  });

  it("counts a backup file that opened as protection", () => {
    const identity = { publicIdentity: PUBLIC_IDENTITY, backup: { verifiedAt: AT } };
    expect(keyBackup(identity)).toEqual({ kind: "file", verified: true, at: new Date(AT) });
    expect(isKeyProtected(identity)).toBe(true);
  });

  it("does not count a file Passport only made, which may never have been saved", () => {
    const identity = { publicIdentity: PUBLIC_IDENTITY, backup: { createdAt: AT } };
    expect(keyBackup(identity)).toEqual({ kind: "file", verified: false, at: new Date(AT) });
    expect(isKeyProtected(identity)).toBe(false);
  });

  it("counts a copy Pubky Ring signed with as protection, like a checked file", () => {
    const identity = { publicIdentity: PUBLIC_IDENTITY, backup: { ringVerifiedAt: AT } };
    expect(keyBackup(identity)).toEqual({ kind: "ring-copy", at: new Date(AT) });
    expect(isKeyProtected(identity)).toBe(true);
    expect(ringVerification(identity)).toEqual(new Date(AT));
    expect(latestBackupVerification(identity)).toEqual({ method: "ring", at: new Date(AT) });
    // An unchecked file beside it does not weaken it.
    const withFile = { ...identity, backup: { ringVerifiedAt: AT, createdAt: LATER } };
    expect(keyBackup(withFile)).toEqual({ kind: "ring-copy", at: new Date(AT) });
    expect(isKeyProtected(withFile)).toBe(true);
  });

  it("names whichever check came last, a file or Pubky Ring", () => {
    const fileLast = {
      publicIdentity: PUBLIC_IDENTITY,
      backup: { ringVerifiedAt: AT, verifiedAt: LATER },
    };
    expect(latestBackupVerification(fileLast)).toEqual({ method: "file", at: new Date(LATER) });
    expect(keyBackup(fileLast)).toEqual({ kind: "file", verified: true, at: new Date(LATER) });
    const ringLast = {
      publicIdentity: PUBLIC_IDENTITY,
      backup: { ringVerifiedAt: LATER, verifiedAt: AT },
    };
    expect(latestBackupVerification(ringLast)).toEqual({ method: "ring", at: new Date(LATER) });
    // An unchecked file is no verification at all.
    expect(
      latestBackupVerification({ publicIdentity: PUBLIC_IDENTITY, backup: { createdAt: AT } }),
    ).toBeUndefined();
    // Google stays first, and a Ring-held key has no Ring copy to verify.
    expect(keyBackup({ ...ringLast, googleAccount: GOOGLE_ACCOUNT }).kind).toBe("google");
    expect(ringVerification({ ...ringLast, keySource: "ring" as const })).toBeUndefined();
  });

  it("keeps an earlier check when a newer file was made but not checked", () => {
    const identity = {
      publicIdentity: PUBLIC_IDENTITY,
      backup: { createdAt: LATER, verifiedAt: AT },
    };
    expect(keyBackupFile(identity)).toEqual({ verified: true, at: new Date(AT) });
    expect(isKeyProtected(identity)).toBe(true);
  });

  it("reads the backup file of a browser key, even one backed up to Google", () => {
    expect(
      keyBackupFile({
        publicIdentity: PUBLIC_IDENTITY,
        googleAccount: GOOGLE_ACCOUNT,
        backup: { createdAt: AT },
      }),
    ).toEqual({ verified: false, at: new Date(AT) });
    expect(keyBackupFile({ publicIdentity: PUBLIC_IDENTITY })).toBeUndefined();
  });

  it("reports a browser key without a known backup as unprotected", () => {
    expect(keyBackup({ publicIdentity: PUBLIC_IDENTITY })).toEqual({ kind: "none" });
    expect(isKeyProtected({ publicIdentity: PUBLIC_IDENTITY })).toBe(false);
    expect(keyBackup({ publicIdentity: PUBLIC_IDENTITY, backup: { createdAt: "never" } })).toEqual({
      kind: "none",
    });
  });
});
