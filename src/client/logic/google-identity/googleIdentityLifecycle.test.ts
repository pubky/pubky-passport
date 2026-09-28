/** @vitest-environment jsdom */

import { Result, type Result as ResultType } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectResultOk } from "@test-utils/resultAssertions";
import { LOGGER } from "@/libs/logger/logger";
import { NETWORK_OPERATION_TIMEOUT_MS } from "@/libs/passportPolicy";
import {
  GoogleIdentityLifecycle,
  type GoogleIdentityLifecycleDependencies,
  type GoogleIdentityProgress,
  type UnlinkedGoogleBackups,
  type UnspentGoogleSignupInvites,
} from "./GoogleIdentityLifecycle";

const MOCKS = {
  createIdentityKey: vi.fn(),
  exportSecretKey: vi.fn(),
  restoreIdentityKey: vi.fn(),
  signup: vi.fn(),
  signin: vi.fn(),
  resolveHomeserver: vi.fn(),
  publishHomeserver: vi.fn(),
  disposeIdentityKey: vi.fn(),
  disposePubky: vi.fn(),
  requestWrappingKey: vi.fn(),
  requestSignupToken: vi.fn(),
  lookUpSignupToken: vi.fn(),
  encryptSecretKeyBytes: vi.fn(),
  decryptSecretKeyBytes: vi.fn(),
  repositorySave: vi.fn(),
  repositorySetGoogleAccount: vi.fn(),
  repositoryRead: vi.fn(),
  contextFetch: { current: undefined as typeof fetch | undefined },
  driveStoreConstructions: { count: 0 },
  visibleCopiesConstructions: { count: 0 },
  readPassportFile: vi.fn(),
  hasPassportFile: vi.fn(),
  deleteInvalidPassportFile: vi.fn(),
  createPassportFile: vi.fn(),
  deletePassportFile: vi.fn(),
  createVisibleRecoveryCopy: vi.fn(),
  deleteVisibleRecoveryCopies: vi.fn(),
  /** The page-scoped record of unlinked backups, shared by every lifecycle one test creates. */
  unlinkedBackups: new Map() as UnlinkedGoogleBackups,
  /** The page-scoped record of unspent Homegate invites, shared like `unlinkedBackups`. */
  unspentSignupInvites: new Map() as UnspentGoogleSignupInvites,
};

const PUBLIC_IDENTITY = {
  publicKeyZ32: "public-identity",
};
const KEY_HANDLE = {};
const IDENTITY = { keyHandle: KEY_HANDLE, publicIdentity: PUBLIC_IDENTITY };
const ENVELOPE = {
  v: 1 as const,
  keyId: "current",
  iv: "a".repeat(16),
  ct: "b".repeat(64),
  url: "https://passport.pubky.app",
};
const FOREIGN_ENVELOPE = { ...ENVELOPE, url: "https://passport-staging.pubky.app" };
const REFERENCE = { storageId: "opaque-file-id", revision: "42" };
const CREDENTIALS = {
  googleIdToken: "google-id-token",
  driveAccessToken: "drive-access-token",
  driveAccessTokenExpiresAt: Date.now() + 3_600_000,
  visibleBackupPermissionGranted: true,
  googleAccount: {
    googleSubject: "google-account",
    email: "user@example.com",
    name: "User",
    pictureUrl: null,
  },
};
const SIGNUP_DETAILS = {
  homeserverPubky: "homeserver-pubky",
  signupToken: "signup-token",
};

describe("Google identity use cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MOCKS.driveStoreConstructions.count = 0;
    MOCKS.visibleCopiesConstructions.count = 0;
    MOCKS.contextFetch.current = undefined;
    MOCKS.unlinkedBackups.clear();
    MOCKS.unspentSignupInvites.clear();
    MOCKS.hasPassportFile.mockResolvedValue(Result.ok(false));
    MOCKS.requestWrappingKey.mockResolvedValue(
      Result.ok({
        wrappingKey: "w".repeat(43),
        keyId: "current",
      }),
    );
    MOCKS.requestSignupToken.mockResolvedValue(Result.ok(SIGNUP_DETAILS));
    MOCKS.lookUpSignupToken.mockResolvedValue({ status: "valid", reached: true });
    MOCKS.createIdentityKey.mockResolvedValue(Result.ok(IDENTITY));
    MOCKS.exportSecretKey.mockImplementation(async () =>
      Result.ok({
        bytes: new Uint8Array(32).fill(7),
        format: "pubky-secret-key",
      }),
    );
    MOCKS.restoreIdentityKey.mockImplementation(async (secretKey: { bytes: Uint8Array }) => {
      secretKey.bytes.fill(0);
      return Result.ok(IDENTITY);
    });
    MOCKS.signup.mockResolvedValue(Result.ok({ publicIdentity: PUBLIC_IDENTITY }));
    MOCKS.signin.mockResolvedValue(Result.ok({ publicIdentity: PUBLIC_IDENTITY }));
    MOCKS.resolveHomeserver.mockResolvedValue(Result.ok(null));
    MOCKS.publishHomeserver.mockResolvedValue(Result.ok());
    MOCKS.encryptSecretKeyBytes.mockResolvedValue(Result.ok(ENVELOPE));
    MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.ok(new Uint8Array(32).fill(9)));
    MOCKS.createPassportFile.mockResolvedValue(Result.ok());
    MOCKS.deleteInvalidPassportFile.mockResolvedValue(Result.ok("deleted"));
    MOCKS.createVisibleRecoveryCopy.mockResolvedValue(Result.ok());
    MOCKS.deletePassportFile.mockResolvedValue(Result.ok());
    MOCKS.deleteVisibleRecoveryCopies.mockResolvedValue(Result.ok());
    MOCKS.repositorySave.mockReturnValue(
      Result.ok({
        publicIdentity: PUBLIC_IDENTITY,
      }),
    );
    MOCKS.repositorySetGoogleAccount.mockReturnValue(Result.ok());
    MOCKS.repositoryRead.mockImplementation(() =>
      Result.ok({
        identity: { publicIdentity: PUBLIC_IDENTITY },
        secretKey: { bytes: new Uint8Array(32).fill(7), format: "pubky-secret-key" },
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates, stores, signs up, publishes, verifies, and saves a missing identity in order", async () => {
    const events: string[] = [];
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    record(MOCKS.requestSignupToken, "homegate", events);
    record(MOCKS.lookUpSignupToken, "homeserver-check", events);
    record(MOCKS.createIdentityKey, "create-key", events);
    record(MOCKS.createPassportFile, "drive-create", events);
    record(MOCKS.createVisibleRecoveryCopy, "visible-copy", events);
    record(MOCKS.signup, "signup", events);
    record(MOCKS.publishHomeserver, "publish-if-stale", events);
    record(MOCKS.signin, "signin", events);
    record(MOCKS.repositorySave, "save", events);
    const progress: GoogleIdentityProgress[] = [];

    const result = await createSubject().establishIdentity(CREDENTIALS, (phase) =>
      progress.push(phase),
    );

    expect(expectResultOk(result)).toEqual({
      establishmentMode: "created",
      publicIdentity: PUBLIC_IDENTITY,
      visibleRecoveryCopyStatus: "created",
    });
    expect(MOCKS.repositorySave).toHaveBeenCalledWith(
      expect.objectContaining({
        profileSetupRequired: true,
        homeserverPubky: SIGNUP_DETAILS.homeserverPubky,
      }),
      expect.anything(),
    );
    expect(events).toEqual([
      "homegate",
      "homeserver-check",
      "create-key",
      "drive-create",
      "visible-copy",
      "signup",
      "publish-if-stale",
      "signin",
      "save",
    ]);
    expect(progress).toEqual([
      { flow: "lookup", step: "checking" },
      { flow: "create", step: "preparing" },
      { flow: "create", step: "creating" },
      { flow: "create", step: "storing_passport_file" },
      { flow: "create", step: "signing_up" },
      { flow: "create", step: "activating" },
    ]);
    expect(MOCKS.lookUpSignupToken).toHaveBeenCalledWith(SIGNUP_DETAILS, expect.any(AbortSignal));
    expect(MOCKS.driveStoreConstructions.count).toBe(1);
    expect(MOCKS.visibleCopiesConstructions.count).toBe(1);
    expect(MOCKS.signin).toHaveBeenCalledWith(KEY_HANDLE, "normal");
    expect(MOCKS.signin).not.toHaveBeenCalledWith(KEY_HANDLE, "after-publication");
    await vi.waitFor(() => expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE));
  });

  it.each([
    ["does not answer", { status: "unknown", reached: false }, "homeserver_unreachable"],
    ["reports the invite used", { status: "used", reached: true }, "homeserver_invite_rejected"],
    [
      "does not know the invite",
      { status: "not_found", reached: true },
      "homeserver_invite_rejected",
    ],
  ] as const)(
    "writes nothing to Drive when the new identity's homeserver %s",
    async (_label, lookup, code) => {
      MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
      MOCKS.lookUpSignupToken.mockResolvedValueOnce(lookup);

      expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
        code,
      });
      expect(MOCKS.createIdentityKey).not.toHaveBeenCalled();
      expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
      expect(MOCKS.createVisibleRecoveryCopy).not.toHaveBeenCalled();
      expect(MOCKS.signup).not.toHaveBeenCalled();
      expect(MOCKS.publishHomeserver).not.toHaveBeenCalled();
      expect(MOCKS.repositorySave).not.toHaveBeenCalled();
    },
  );

  it("creates the identity when the homeserver answers without confirming the invite", async () => {
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.lookUpSignupToken.mockResolvedValueOnce({ status: "unknown", reached: true });

    expect(
      expectResultOk(await createSubject().establishIdentity(CREDENTIALS, () => undefined)),
    ).toMatchObject({ establishmentMode: "created" });
    expect(MOCKS.createPassportFile).toHaveBeenCalledOnce();
    expect(MOCKS.signup).toHaveBeenCalledOnce();
  });

  it("retries with the unspent invite of an attempt whose homeserver did not answer", async () => {
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.lookUpSignupToken.mockResolvedValueOnce({ status: "unknown", reached: false });
    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: "homeserver_unreachable",
    });

    // Try again builds a new lifecycle on the same page.
    expectResultOk(await createSubject().establishIdentity(CREDENTIALS, () => undefined));
    expect(MOCKS.requestSignupToken).toHaveBeenCalledOnce();
    expect(MOCKS.lookUpSignupToken).toHaveBeenCalledTimes(2);
    expect(MOCKS.lookUpSignupToken).toHaveBeenLastCalledWith(
      SIGNUP_DETAILS,
      expect.any(AbortSignal),
    );
    expect(MOCKS.signup).toHaveBeenCalledWith(
      KEY_HANDLE,
      SIGNUP_DETAILS.homeserverPubky,
      SIGNUP_DETAILS.signupToken,
    );

    // That signup used the invite, so the next identity needs a new one.
    expectResultOk(await createSubject().establishIdentity(CREDENTIALS, () => undefined));
    expect(MOCKS.requestSignupToken).toHaveBeenCalledTimes(2);
  });

  it("keeps the invite of an attempt that stopped before signing up", async () => {
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.createPassportFile.mockResolvedValueOnce(Result.err({ code: "drive_write_failed" }));
    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: "drive_write_failed",
    });

    expectResultOk(await createSubject().establishIdentity(CREDENTIALS, () => undefined));
    expect(MOCKS.requestSignupToken).toHaveBeenCalledOnce();
    expect(MOCKS.signup).toHaveBeenCalledOnce();
  });

  it("keeps an unspent invite to the Google account it was issued for", async () => {
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.lookUpSignupToken.mockResolvedValueOnce({ status: "unknown", reached: false });
    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: "homeserver_unreachable",
    });
    const otherAccount = { ...CREDENTIALS.googleAccount, googleSubject: "other-google-account" };
    const otherDetails = { homeserverPubky: "homeserver-pubky", signupToken: "other-token" };
    MOCKS.requestSignupToken.mockResolvedValueOnce(Result.ok(otherDetails));

    expectResultOk(
      await createSubject().establishIdentity(
        { ...CREDENTIALS, googleIdToken: "other-id-token", googleAccount: otherAccount },
        () => undefined,
      ),
    );
    expect(MOCKS.requestSignupToken).toHaveBeenCalledTimes(2);
    expect(MOCKS.requestSignupToken).toHaveBeenLastCalledWith("other-id-token");
    expect(MOCKS.signup).toHaveBeenCalledWith(KEY_HANDLE, "homeserver-pubky", "other-token");
  });

  it.each([
    ["the homeserver refused the invite", "homeserver_invite_rejected"],
    ["a signup tried the invite", "signup_failed"],
  ] as const)("requests a new invite once %s", async (_label, code) => {
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    if (code === "homeserver_invite_rejected") {
      MOCKS.lookUpSignupToken.mockResolvedValueOnce({ status: "used", reached: true });
    } else {
      MOCKS.signup.mockResolvedValueOnce(Result.err({ code: "signup_failed" }));
    }
    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code,
    });

    expectResultOk(await createSubject().establishIdentity(CREDENTIALS, () => undefined));
    expect(MOCKS.requestSignupToken).toHaveBeenCalledTimes(2);
  });

  it("asks for a decision only after finding no identity, before creating anything", async () => {
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));

    expectResultError(
      await createSubject().establishIdentity(
        { ...CREDENTIALS, visibleBackupPermissionGranted: false },
        () => undefined,
      ),
      { code: "visible_backup_permission_missing" },
    );

    expect(MOCKS.readPassportFile).toHaveBeenCalledOnce();
    expect(MOCKS.requestWrappingKey).not.toHaveBeenCalled();
    expect(MOCKS.requestSignupToken).not.toHaveBeenCalled();
    expect(MOCKS.createIdentityKey).not.toHaveBeenCalled();
    expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.repositorySave).not.toHaveBeenCalled();
  });

  it("restores an existing identity without visible-copy permission or an extra decision", async () => {
    MOCKS.readPassportFile.mockResolvedValue(
      Result.ok({ status: "found", envelope: ENVELOPE, reference: REFERENCE }),
    );

    const result = await createSubject().establishIdentity(
      { ...CREDENTIALS, visibleBackupPermissionGranted: false },
      () => undefined,
    );

    expect(expectResultOk(result).establishmentMode).toBe("restored");
    expect(MOCKS.repositorySave).toHaveBeenCalledOnce();
    // A restore did not sign the key up, so it cannot say which homeserver holds the account.
    expect(MOCKS.repositorySave.mock.calls[0]?.[0]).not.toHaveProperty("homeserverPubky");
    expect(MOCKS.visibleCopiesConstructions.count).toBe(0);
    expect(MOCKS.createVisibleRecoveryCopy).not.toHaveBeenCalled();
  });

  it("keeps an invalid file until the visible-backup decision is made", async () => {
    expectResultError(
      await createSubject().replaceInvalidPassportFile(
        { ...CREDENTIALS, visibleBackupPermissionGranted: false },
        () => undefined,
      ),
      { code: "visible_backup_permission_missing" },
    );
    expect(MOCKS.deleteInvalidPassportFile).not.toHaveBeenCalled();
  });

  it("requires visible-copy permission before detaching or removing anything", async () => {
    expectResultError(
      await createSubject().detachIdentity(
        { ...CREDENTIALS, visibleBackupPermissionGranted: false },
        PUBLIC_IDENTITY,
        CREDENTIALS.googleAccount.googleSubject,
      ),
      { code: "google_detachment_permission_required" },
    );

    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.deleteVisibleRecoveryCopies).not.toHaveBeenCalled();
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(MOCKS.repositorySetGoogleAccount).not.toHaveBeenCalled();
  });

  it("stores the private backup but skips visible-copy APIs when that permission was declined", async () => {
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));

    const result = await createSubject().establishIdentity(
      { ...CREDENTIALS, visibleBackupPermissionGranted: false },
      () => undefined,
      true,
    );

    expect(expectResultOk(result)).toEqual({
      establishmentMode: "created",
      publicIdentity: PUBLIC_IDENTITY,
      visibleRecoveryCopyStatus: "skipped",
    });
    expect(MOCKS.createPassportFile).toHaveBeenCalledOnce();
    expect(MOCKS.visibleCopiesConstructions.count).toBe(0);
    expect(MOCKS.createVisibleRecoveryCopy).not.toHaveBeenCalled();
  });

  it("clears the exported secret before waiting on the Drive write", async () => {
    const exportedBytes = new Uint8Array(32).fill(7);
    let finishDriveWrite!: () => void;
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.exportSecretKey.mockResolvedValueOnce(
      Result.ok({
        bytes: exportedBytes,
        format: "pubky-secret-key",
      }),
    );
    MOCKS.createPassportFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDriveWrite = () => resolve(Result.ok());
        }),
    );

    const pending = createSubject().establishIdentity(CREDENTIALS, () => undefined);
    await vi.waitFor(() => expect(MOCKS.createPassportFile).toHaveBeenCalledOnce());

    expect(exportedBytes).toEqual(new Uint8Array(32));
    finishDriveWrite();
    expectResultOk(await pending);
  });

  it.each([
    ["drive-read", { code: "drive_read_failed" }],
    ["wrapping-key", { code: "wrapping_key_failed", detailCode: "network_failed" }],
    ["key-creation", { code: "create_failed" }],
    ["encryption", { code: "encrypt_failed" }],
    ["drive-conflict", { code: "drive_create_conflict" }],
    ["decryption", { code: "decrypt_failed" }],
  ] as const)("maps an early %s failure without continuing", async (stage, expectedError) => {
    if (stage === "drive-read") {
      MOCKS.readPassportFile.mockResolvedValue(Result.err({ code: "network_failed" }));
    } else if (stage === "decryption") {
      foundPassportFile();
      MOCKS.decryptSecretKeyBytes.mockResolvedValue(
        Result.err({ code: "unsupported_browser_crypto" }),
      );
    } else {
      MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
      if (stage === "wrapping-key") {
        MOCKS.requestWrappingKey.mockResolvedValue(Result.err({ code: "network_failed" }));
      } else if (stage === "key-creation") {
        MOCKS.createIdentityKey.mockResolvedValue(Result.err({ code: "create_failed" }));
      } else if (stage === "encryption") {
        MOCKS.encryptSecretKeyBytes.mockResolvedValue(Result.err({ code: "encrypt_failed" }));
      } else {
        MOCKS.createPassportFile.mockResolvedValue(Result.err({ code: "create_conflict" }));
      }
    }

    expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, () => undefined),
      expectedError,
    );
    expect(MOCKS.repositorySave).not.toHaveBeenCalled();
    if (stage === "drive-read") expect(MOCKS.requestWrappingKey).not.toHaveBeenCalled();
    if (stage === "wrapping-key") expect(MOCKS.requestSignupToken).not.toHaveBeenCalled();
  });

  it("translates lower failures while retaining internal diagnostic causes", async () => {
    const diagnosticCanary = { secret: "TRANSLATED-CAUSE-CANARY" };
    const lowerFailure = {
      code: "network_failed" as const,
      cause: diagnosticCanary,
    };
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.requestWrappingKey.mockResolvedValue(Result.err(lowerFailure));

    const failure = expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, () => undefined),
      { code: "wrapping_key_failed", detailCode: "network_failed" },
    );

    expect(failure.cause).toBe(lowerFailure);
  });

  it("classifies broad exceptions without logging their details", async () => {
    const thrown = { secret: "BROAD-CATCH-CANARY" };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.readPassportFile.mockRejectedValue(thrown);

    const failure = expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, () => undefined),
      { code: "unexpected_failure" },
    );

    expect(failure.cause).toBe(thrown);
    expect(JSON.stringify(warning.mock.calls)).not.toContain("BROAD-CATCH-CANARY");
  });

  it("reports a malformed file naming another Passport origin as foreign, never deletable", async () => {
    MOCKS.readPassportFile.mockResolvedValue(
      Result.err({ code: "invalid_file", passportFileOrigin: FOREIGN_ENVELOPE.url }),
    );

    const failure = expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, () => undefined),
      { code: "foreign_passport_file" },
    );
    expect(failure).toMatchObject({ passportFileOrigin: FOREIGN_ENVELOPE.url });
    expect(MOCKS.deleteInvalidPassportFile).not.toHaveBeenCalled();
  });

  it("only asks the store to delete a malformed file that belongs to this origin", async () => {
    MOCKS.deleteInvalidPassportFile.mockResolvedValue(
      Result.err({ code: "foreign_file", passportFileOrigin: FOREIGN_ENVELOPE.url }),
    );

    expectResultError(
      await createSubject().replaceInvalidPassportFile(CREDENTIALS, () => undefined),
      { code: "foreign_passport_file" },
    );
    expect(MOCKS.deleteInvalidPassportFile).toHaveBeenCalledWith(ENVELOPE.url);
    expect(MOCKS.createIdentityKey).not.toHaveBeenCalled();
  });

  it("exposes malformed passport files as a specific recoverable error", async () => {
    MOCKS.readPassportFile.mockResolvedValue(Result.err({ code: "invalid_file" }));

    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: "invalid_passport_file",
    });
    expect(MOCKS.requestWrappingKey).not.toHaveBeenCalled();
  });

  it.each(["deleted", "missing"] as const)(
    "automatically creates a new identity after the invalid file is %s",
    async (deletionStatus) => {
      const events: string[] = [];
      MOCKS.deleteInvalidPassportFile.mockResolvedValue(Result.ok(deletionStatus));
      MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
      record(MOCKS.deleteInvalidPassportFile, "delete-invalid-file", events);
      record(MOCKS.createIdentityKey, "create-key", events);

      const result = await createSubject().replaceInvalidPassportFile(CREDENTIALS, () => undefined);

      expect(expectResultOk(result)).toMatchObject({
        establishmentMode: "created",
        publicIdentity: PUBLIC_IDENTITY,
      });
      expect(events).toEqual(["delete-invalid-file", "create-key"]);
      expect(MOCKS.driveStoreConstructions.count).toBe(2);
    },
  );

  it("contains a rejected establishment after invalid-file deletion", async () => {
    const thrown = new Error("REPLACEMENT-REJECTION-CANARY");
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const subject = createSubject();
    MOCKS.deleteInvalidPassportFile.mockResolvedValue(Result.ok("deleted"));
    vi.spyOn(subject, "establishIdentity").mockRejectedValue(thrown);

    const failure = expectResultError(
      await subject.replaceInvalidPassportFile(CREDENTIALS, () => undefined),
      { code: "invalid_passport_file_delete_failed" },
    );

    expect(failure.cause).toBe(thrown);
    expect(JSON.stringify(warning.mock.calls)).not.toContain("REPLACEMENT-REJECTION-CANARY");
  });

  it("does not create an identity when invalid-file deletion fails", async () => {
    MOCKS.deleteInvalidPassportFile.mockResolvedValue(Result.err({ code: "delete_failed" }));

    expectResultError(
      await createSubject().replaceInvalidPassportFile(CREDENTIALS, () => undefined),
      { code: "invalid_passport_file_delete_failed" },
    );
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.createIdentityKey).not.toHaveBeenCalled();
  });

  it("does not replace an invalid file that became valid before confirmation", async () => {
    MOCKS.deleteInvalidPassportFile.mockResolvedValue(Result.err({ code: "stale_file" }));

    expectResultError(
      await createSubject().replaceInvalidPassportFile(CREDENTIALS, () => undefined),
      { code: "invalid_passport_file_delete_failed" },
    );
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.createIdentityKey).not.toHaveBeenCalled();
  });

  it("keeps an undecryptable file until the visible-backup decision is made", async () => {
    expectResultError(
      await createSubject().replaceUndecryptablePassportFile(
        { ...CREDENTIALS, visibleBackupPermissionGranted: false },
        () => undefined,
      ),
      { code: "visible_backup_permission_missing" },
    );
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
  });

  it("deletes the exact file revision that failed to decrypt, then creates a new identity", async () => {
    const events: string[] = [];
    foundPassportFile();
    MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.err({ code: "decrypt_failed" }));
    record(MOCKS.decryptSecretKeyBytes, "decrypt", events);
    record(MOCKS.deletePassportFile, "delete-file", events);
    record(MOCKS.createIdentityKey, "create-key", events);
    const progress: GoogleIdentityProgress[] = [];

    const result = await createSubject().replaceUndecryptablePassportFile(CREDENTIALS, (phase) =>
      progress.push(phase),
    );

    expect(expectResultOk(result)).toEqual({
      establishmentMode: "created",
      publicIdentity: PUBLIC_IDENTITY,
      visibleRecoveryCopyStatus: "created",
    });
    expect(events).toEqual(["decrypt", "delete-file", "create-key"]);
    expect(MOCKS.deletePassportFile).toHaveBeenCalledWith(REFERENCE);
    expect(MOCKS.deleteInvalidPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.restoreIdentityKey).not.toHaveBeenCalled();
    expect(MOCKS.readPassportFile).toHaveBeenCalledOnce();
    expect(MOCKS.driveStoreConstructions.count).toBe(1);
    expect(progress).toEqual([
      { flow: "lookup", step: "checking" },
      { flow: "restore", step: "restoring" },
      { flow: "create", step: "preparing" },
      { flow: "create", step: "creating" },
      { flow: "create", step: "storing_passport_file" },
      { flow: "create", step: "signing_up" },
      { flow: "create", step: "activating" },
    ]);
  });

  it("restores instead of deleting a file that decrypts after all", async () => {
    foundPassportFile();

    const result = await createSubject().replaceUndecryptablePassportFile(
      CREDENTIALS,
      () => undefined,
    );

    expect(expectResultOk(result)).toEqual({
      establishmentMode: "restored",
      publicIdentity: PUBLIC_IDENTITY,
    });
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(MOCKS.createIdentityKey).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE));
  });

  it("offers deletion for an own-origin file the wrapping key no longer opens", async () => {
    foundPassportFile();
    MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.err({ code: "decrypt_failed" }));

    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: "passport_file_undecryptable",
    });
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(MOCKS.createIdentityKey).not.toHaveBeenCalled();
  });

  it("restores a file written by another Passport origin when it decrypts", async () => {
    foundPassportFile(FOREIGN_ENVELOPE);

    expect(
      expectResultOk(await createSubject().establishIdentity(CREDENTIALS, () => undefined)),
    ).toMatchObject({ establishmentMode: "restored" });
    expect(MOCKS.decryptSecretKeyBytes).toHaveBeenCalledWith(FOREIGN_ENVELOPE, "w".repeat(43));
  });

  it.each([
    [
      "restore_failed",
      () => MOCKS.restoreIdentityKey.mockResolvedValue(Result.err({ code: "restore_failed" })),
    ],
    [
      "wrapping_key_failed",
      () => MOCKS.requestWrappingKey.mockResolvedValue(Result.err({ code: "network_failed" })),
    ],
    [
      "signin_failed",
      () => {
        MOCKS.signin.mockResolvedValue(Result.err({ code: "signin_failed" }));
        MOCKS.resolveHomeserver.mockResolvedValue(Result.ok("homeserver-pubky"));
      },
    ],
  ] as const)(
    "keeps a file whose restoration fails with %s rather than decryption",
    async (code, arrange) => {
      foundPassportFile();
      arrange();

      expectResultError(
        await createSubject().replaceUndecryptablePassportFile(CREDENTIALS, () => undefined),
        { code },
      );
      expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
      expect(MOCKS.createIdentityKey).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "decryption",
      () => MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.err({ code: "decrypt_failed" })),
    ],
    [
      "an unknown key ID",
      () => MOCKS.requestWrappingKey.mockResolvedValue(Result.err({ code: "key_unavailable" })),
    ],
  ] as const)(
    "reports a foreign file that fails %s with its origin and never deletes it",
    async (_stage, arrange) => {
      foundPassportFile(FOREIGN_ENVELOPE);
      arrange();

      const failure = expectResultError(
        await createSubject().establishIdentity(CREDENTIALS, () => undefined),
        { code: "foreign_passport_file" },
      );
      expect(failure).toMatchObject({ passportFileOrigin: FOREIGN_ENVELOPE.url });
      expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
      expect(MOCKS.createIdentityKey).not.toHaveBeenCalled();
    },
  );

  it("does not create an identity when the undecryptable file cannot be deleted", async () => {
    foundPassportFile();
    MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.err({ code: "decrypt_failed" }));
    MOCKS.deletePassportFile.mockResolvedValue(Result.err({ code: "stale_file" }));

    const failure = expectResultError(
      await createSubject().replaceUndecryptablePassportFile(CREDENTIALS, () => undefined),
      { code: "undecryptable_passport_file_delete_failed" },
    );

    expect(failure.cause).toEqual({ code: "stale_file" });
    expect(MOCKS.requestSignupToken).not.toHaveBeenCalled();
    expect(MOCKS.createIdentityKey).not.toHaveBeenCalled();
  });

  it("never deletes a file that fails to decrypt during plain establishment", async () => {
    foundPassportFile();
    MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.err({ code: "decrypt_failed" }));

    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: "passport_file_undecryptable",
    });
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(MOCKS.createIdentityKey).not.toHaveBeenCalled();
  });

  it("keeps an own-origin unknown key ID as a wrapping-key failure", async () => {
    foundPassportFile();
    MOCKS.requestWrappingKey.mockResolvedValue(Result.err({ code: "key_unavailable" }));

    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: "wrapping_key_failed",
      detailCode: "key_unavailable",
    });
  });

  it.each([
    [
      "a foreign file",
      FOREIGN_ENVELOPE,
      Result.err({ code: "decrypt_failed" }),
      "foreign_passport_file",
    ],
    ["an own file that now decrypts", ENVELOPE, undefined, undefined],
    ["an own file whose key cannot be fetched", ENVELOPE, "wrapping-key", "wrapping_key_failed"],
  ] as const)(
    "never deletes %s during replacement",
    async (_label, envelope, failure, expectedCode) => {
      foundPassportFile(envelope);
      if (failure === "wrapping-key") {
        MOCKS.requestWrappingKey.mockResolvedValue(Result.err({ code: "network_failed" }));
      } else if (failure !== undefined) {
        MOCKS.decryptSecretKeyBytes.mockResolvedValue(failure);
      }

      const result = await createSubject().replaceUndecryptablePassportFile(
        CREDENTIALS,
        () => undefined,
      );

      if (expectedCode === undefined) {
        expect(expectResultOk(result)).toMatchObject({ establishmentMode: "restored" });
      } else {
        expectResultError(result, { code: expectedCode });
      }
      expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
      expect(MOCKS.deleteInvalidPassportFile).not.toHaveBeenCalled();
    },
  );

  it("restores through normal sign-in, republishes in the background, and does not request Homegate", async () => {
    const decryptedBytes = new Uint8Array(32).fill(9);
    MOCKS.readPassportFile.mockResolvedValue(
      Result.ok({
        status: "found",
        envelope: ENVELOPE,
        reference: REFERENCE,
      }),
    );
    MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.ok(decryptedBytes));
    const progress: GoogleIdentityProgress[] = [];

    const result = await createSubject().establishIdentity(CREDENTIALS, (phase) =>
      progress.push(phase),
    );

    expect(expectResultOk(result)).toEqual({
      establishmentMode: "restored",
      publicIdentity: PUBLIC_IDENTITY,
    });
    expect(MOCKS.requestSignupToken).not.toHaveBeenCalled();
    expect(MOCKS.signup).not.toHaveBeenCalled();
    expect(MOCKS.publishHomeserver).toHaveBeenCalledWith(KEY_HANDLE);
    expect(MOCKS.signin).toHaveBeenCalledWith(KEY_HANDLE, "normal");
    expect(MOCKS.resolveHomeserver).not.toHaveBeenCalled();
    expect(decryptedBytes).toEqual(new Uint8Array(32));
    await vi.waitFor(() => expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE));
    expect(progress).toEqual([
      { flow: "lookup", step: "checking" },
      { flow: "restore", step: "restoring" },
      { flow: "restore", step: "signing_in" },
    ]);
  });

  it("does not await homeserver republish on the restore path", async () => {
    foundPassportFile();
    let finishRepublish: (value: ResultType<void, { code: string }>) => void = () => undefined;
    MOCKS.publishHomeserver.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRepublish = resolve;
        }),
    );

    expectResultOk(await createSubject().establishIdentity(CREDENTIALS, () => undefined));
    expect(MOCKS.publishHomeserver).toHaveBeenCalledWith(KEY_HANDLE);
    expect(MOCKS.disposeIdentityKey).not.toHaveBeenCalled();

    finishRepublish(Result.ok());
    await vi.waitFor(() => expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE));
  });

  it("does not dispose the shared Pubky adapter until background republish settles", async () => {
    foundPassportFile();
    let finishRepublish: (value: ResultType<void, { code: string }>) => void = () => undefined;
    MOCKS.publishHomeserver.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRepublish = resolve;
        }),
    );
    const subject = createSubject();

    expectResultOk(await subject.establishIdentity(CREDENTIALS, () => undefined));
    subject.dispose();
    expect(MOCKS.disposeIdentityKey).not.toHaveBeenCalled();
    expect(MOCKS.disposePubky).not.toHaveBeenCalled();

    finishRepublish(Result.ok());
    await vi.waitFor(() => {
      expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
      expect(MOCKS.disposePubky).toHaveBeenCalledOnce();
    });
  });

  it("does not request another signup token when an established identity sign-in fails", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValue(Result.err({ code: "signin_failed" }));
    MOCKS.resolveHomeserver.mockResolvedValue(Result.ok("existing-homeserver"));

    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: "signin_failed",
    });

    expect(MOCKS.resolveHomeserver).toHaveBeenCalledWith(PUBLIC_IDENTITY.publicKeyZ32);
    expect(MOCKS.requestSignupToken).not.toHaveBeenCalled();
    expect(MOCKS.signup).not.toHaveBeenCalled();
    expect(MOCKS.publishHomeserver).not.toHaveBeenCalled();
  });

  it("does not request a signup token when homeserver resolution is uncertain", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValue(Result.err({ code: "signin_failed" }));
    MOCKS.resolveHomeserver.mockResolvedValue(Result.err({ code: "resolution_failed" }));

    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: "signin_failed",
    });

    expect(MOCKS.requestSignupToken).not.toHaveBeenCalled();
    expect(MOCKS.signup).not.toHaveBeenCalled();
    expect(MOCKS.publishHomeserver).not.toHaveBeenCalled();
  });

  it("reconciles an interrupted setup after normal sign-in fails", async () => {
    const events: string[] = [];
    foundPassportFile();
    let signinAttempt = 0;
    MOCKS.signin.mockImplementation(async () => {
      events.push("signin");
      signinAttempt += 1;
      return signinAttempt === 1
        ? Result.err({ code: "signin_failed" })
        : Result.ok({ publicIdentity: PUBLIC_IDENTITY });
    });
    MOCKS.publishHomeserver.mockImplementation(async () => {
      events.push("publish-if-stale");
      return Result.err({ code: "publish_failed" });
    });
    record(MOCKS.requestSignupToken, "homegate", events);
    record(MOCKS.signup, "signup", events);
    record(MOCKS.repositorySave, "save", events);
    const progress: GoogleIdentityProgress[] = [];

    expectResultOk(
      await createSubject().establishIdentity(CREDENTIALS, (phase) => progress.push(phase)),
    );

    expect(MOCKS.requestSignupToken).toHaveBeenCalledWith(CREDENTIALS.googleIdToken);
    expect(MOCKS.resolveHomeserver).toHaveBeenCalledWith(PUBLIC_IDENTITY.publicKeyZ32);
    expect(events).toEqual(["signin", "homegate", "signup", "publish-if-stale", "signin", "save"]);
    expect(MOCKS.signup).toHaveBeenCalledWith(
      KEY_HANDLE,
      SIGNUP_DETAILS.homeserverPubky,
      SIGNUP_DETAILS.signupToken,
    );
    expect(MOCKS.publishHomeserver).toHaveBeenCalledWith(
      KEY_HANDLE,
      SIGNUP_DETAILS.homeserverPubky,
    );
    expect(MOCKS.signin).toHaveBeenCalledWith(KEY_HANDLE, "normal");
    expect(MOCKS.signin).toHaveBeenCalledWith(KEY_HANDLE, "after-publication");
    expect(MOCKS.repositorySave).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ homeserverPubky: SIGNUP_DETAILS.homeserverPubky }),
      expect.anything(),
    );
    expect(progress).toEqual([
      { flow: "lookup", step: "checking" },
      { flow: "restore", step: "restoring" },
      { flow: "restore", step: "signing_in" },
      { flow: "repair", step: "signing_up" },
      { flow: "repair", step: "publishing" },
      { flow: "repair", step: "signing_in" },
    ]);
  });

  it("publishes no record for a repair whose homeserver does not answer", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }));
    MOCKS.lookUpSignupToken.mockResolvedValueOnce({ status: "unknown", reached: false });

    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: "homeserver_unreachable",
    });
    expect(MOCKS.lookUpSignupToken).toHaveBeenCalledWith(SIGNUP_DETAILS, expect.any(AbortSignal));
    expect(MOCKS.signup).not.toHaveBeenCalled();
    expect(MOCKS.publishHomeserver).not.toHaveBeenCalled();
    expect(MOCKS.repositorySave).not.toHaveBeenCalled();
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);

    // The next repair uses the same invite instead of another Google verification.
    MOCKS.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }));
    expectResultOk(await createSubject().establishIdentity(CREDENTIALS, () => undefined));
    expect(MOCKS.requestSignupToken).toHaveBeenCalledOnce();
    expect(MOCKS.signup).toHaveBeenCalledWith(
      KEY_HANDLE,
      SIGNUP_DETAILS.homeserverPubky,
      SIGNUP_DETAILS.signupToken,
    );
  });

  it("repairs with an invite the homeserver reports used, which the key may have spent", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }));
    MOCKS.lookUpSignupToken.mockResolvedValueOnce({ status: "used", reached: true });
    MOCKS.signup.mockResolvedValue(Result.err({ code: "account_exists" }));

    expectResultOk(await createSubject().establishIdentity(CREDENTIALS, () => undefined));
    expect(MOCKS.signup).toHaveBeenCalledOnce();
    expect(MOCKS.repositorySave).toHaveBeenCalledOnce();
  });

  it("republishes when restored-identity signup reports that the account exists", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }));
    MOCKS.publishHomeserver.mockResolvedValueOnce(Result.err({ code: "publish_failed" }));
    MOCKS.signup.mockResolvedValue(Result.err({ code: "account_exists" }));

    expectResultOk(await createSubject().establishIdentity(CREDENTIALS, () => undefined));

    expect(MOCKS.publishHomeserver).toHaveBeenCalledOnce();
    expect(MOCKS.signin).toHaveBeenCalledTimes(2);
    expect(MOCKS.repositorySave).toHaveBeenCalledOnce();
  });

  it.each([
    ["an existing account", Result.err({ code: "account_exists" }), false],
    ["an uncertain signup", Result.err({ code: "signup_uncertain" }), false],
    ["a new account", Result.ok({ publicIdentity: PUBLIC_IDENTITY }), true],
  ] as const)(
    "asks for profile setup after repair only when signup created %s",
    async (_label, signedUp, profileSetupRequired) => {
      foundPassportFile();
      MOCKS.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }));
      MOCKS.signup.mockResolvedValue(signedUp);

      expect(
        expectResultOk(await createSubject().establishIdentity(CREDENTIALS, () => undefined)),
      ).toMatchObject({ establishmentMode: "restored" });

      const [saved] = MOCKS.repositorySave.mock.calls[0] ?? [];
      expect(saved).toMatchObject({ publicIdentity: PUBLIC_IDENTITY });
      expect("profileSetupRequired" in saved).toBe(profileSetupRequired);
    },
  );

  it("asks a new identity for profile setup even when its signup was uncertain", async () => {
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.signup.mockResolvedValue(Result.err({ code: "signup_uncertain" }));

    expectResultOk(await createSubject().establishIdentity(CREDENTIALS, () => undefined));

    expect(MOCKS.repositorySave).toHaveBeenCalledWith(
      expect.objectContaining({ profileSetupRequired: true }),
      expect.anything(),
    );
  });

  it("reports repair before requesting a replacement homeserver signup token", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }));
    const events: Array<string | GoogleIdentityProgress> = [];
    MOCKS.requestSignupToken.mockImplementation(async () => {
      events.push("homegate");
      return Result.err({ code: "network_failed" });
    });

    expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, (phase) => events.push(phase)),
      { code: "homeserver_signup_token_failed", detailCode: "network_failed" },
    );

    expect(events.slice(-2)).toEqual([{ flow: "repair", step: "signing_up" }, "homegate"]);
  });

  it("accepts repaired sign-in when PKDNS publication reports an uncertain failure", async () => {
    foundPassportFile();
    MOCKS.signin
      .mockResolvedValueOnce(Result.err({ code: "signin_failed" }))
      .mockResolvedValue(Result.ok({ publicIdentity: PUBLIC_IDENTITY }));
    MOCKS.publishHomeserver.mockResolvedValueOnce(Result.err({ code: "publish_failed" }));
    const progress: GoogleIdentityProgress[] = [];

    expectResultOk(
      await createSubject().establishIdentity(CREDENTIALS, (phase) => progress.push(phase)),
    );

    expect(progress.at(-1)).toEqual({ flow: "repair", step: "signing_in" });
    expect(MOCKS.repositorySave).toHaveBeenCalledOnce();
  });

  it("fails publication when uncertain repaired publication cannot be verified by sign-in", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValue(Result.err({ code: "signin_failed" }));
    MOCKS.publishHomeserver.mockResolvedValueOnce(Result.err({ code: "publish_failed" }));

    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: "publication_failed",
    });

    expect(MOCKS.signin).toHaveBeenCalledTimes(2);
    expect(MOCKS.repositorySave).not.toHaveBeenCalled();
  });

  it("does not verify a definitive repaired publication failure through sign-in", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }));
    MOCKS.publishHomeserver.mockResolvedValueOnce(Result.err({ code: "invalid_homeserver_pubky" }));

    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: "publication_failed",
    });

    expect(MOCKS.signin).toHaveBeenCalledOnce();
    expect(MOCKS.repositorySave).not.toHaveBeenCalled();
  });

  it("stops on repaired sign-in failure without saving locally", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValue(Result.err({ code: "signin_failed" }));
    const progress: GoogleIdentityProgress[] = [];

    expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, (phase) => progress.push(phase)),
      { code: "signin_failed" },
    );

    expect(progress.at(-1)).toEqual({ flow: "repair", step: "signing_in" });
    expect(MOCKS.repositorySave).not.toHaveBeenCalled();
  });

  it("rejects a mismatched repaired identity before local persistence", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" })).mockResolvedValue(
      Result.ok({
        publicIdentity: { publicKeyZ32: "different" },
      }),
    );

    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: "identity_mismatch",
    });

    expect(MOCKS.repositorySave).not.toHaveBeenCalled();
  });

  it("verifies an ambiguous signup failure before accepting the recovered account", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }));
    MOCKS.publishHomeserver.mockResolvedValueOnce(Result.err({ code: "publish_failed" }));
    MOCKS.signup.mockResolvedValue(Result.err({ code: "signup_uncertain" }));

    expectResultOk(await createSubject().establishIdentity(CREDENTIALS, () => undefined));

    expect(MOCKS.publishHomeserver).toHaveBeenCalledOnce();
    expect(MOCKS.signin).toHaveBeenCalledTimes(2);
    expect(MOCKS.repositorySave).toHaveBeenCalledOnce();
  });

  it("does not publish or save after a definitive signup rejection", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }));
    MOCKS.signup.mockResolvedValue(Result.err({ code: "signup_failed" }));

    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: "signup_failed",
    });
    expect(MOCKS.publishHomeserver).not.toHaveBeenCalled();
    expect(MOCKS.repositorySave).not.toHaveBeenCalled();
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
  });

  it.each([
    ["signin", "signin_failed"],
    ["local-save", "local_save_failed"],
  ] as const)("stops and disposes the key after a %s failure", async (stage, expectedCode) => {
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    if (stage === "signin") {
      MOCKS.signin.mockResolvedValue(Result.err({ code: "signin_failed" }));
    } else {
      MOCKS.repositorySave.mockReturnValue(Result.err({ code: "storage_unavailable" }));
    }

    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: expectedCode,
    });
    await vi.waitFor(() => expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE));
  });

  it("keeps a new identity when its background republish fails", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.publishHomeserver.mockResolvedValue(Result.err({ code: "publish_failed" }));

    expectResultOk(await createSubject().establishIdentity(CREDENTIALS, () => undefined));

    expect(MOCKS.signin).toHaveBeenCalledWith(KEY_HANDLE, "normal");
    expect(MOCKS.repositorySave).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        "identity.homeserver.republish.failed",
        expect.objectContaining({ code: "publish_failed" }),
      ),
    );
    await vi.waitFor(() => expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE));
  });

  it("does not await the background republish after a definitive signup", async () => {
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    let finishRepublish: (value: ResultType<void, { code: string }>) => void = () => undefined;
    MOCKS.publishHomeserver.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRepublish = resolve;
        }),
    );
    const subject = createSubject();

    expectResultOk(await subject.establishIdentity(CREDENTIALS, () => undefined));
    expect(MOCKS.publishHomeserver).toHaveBeenCalledWith(
      KEY_HANDLE,
      SIGNUP_DETAILS.homeserverPubky,
    );
    expect(MOCKS.disposeIdentityKey).not.toHaveBeenCalled();
    subject.dispose();
    expect(MOCKS.disposePubky).not.toHaveBeenCalled();

    finishRepublish(Result.ok());
    await vi.waitFor(() => {
      expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
      expect(MOCKS.disposePubky).toHaveBeenCalledOnce();
    });
  });

  it("uploads the visible recovery copy while homeserver activation runs", async () => {
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    let finishCopy: (value: ResultType<void, { code: string }>) => void = () => undefined;
    MOCKS.createVisibleRecoveryCopy.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCopy = resolve;
        }),
    );

    const pending = createSubject().establishIdentity(CREDENTIALS, () => undefined);
    await vi.waitFor(() => expect(MOCKS.repositorySave).toHaveBeenCalledOnce());
    expect(MOCKS.createVisibleRecoveryCopy).toHaveBeenCalledOnce();

    finishCopy(Result.ok());
    expect(expectResultOk(await pending)).toMatchObject({ visibleRecoveryCopyStatus: "created" });
  });

  it("relies on the Pubky adapter to clear decrypted bytes when key restoration fails", async () => {
    const decryptedBytes = new Uint8Array(32).fill(9);
    foundPassportFile();
    MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.ok(decryptedBytes));
    MOCKS.restoreIdentityKey.mockImplementation(async (secretKey: { bytes: Uint8Array }) => {
      secretKey.bytes.fill(0);
      return Result.err({ code: "restore_failed" });
    });

    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: "restore_failed",
    });
    expect(decryptedBytes).toEqual(new Uint8Array(32));
  });

  it("rejects a mismatched sign-in identity before local persistence", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValue(
      Result.ok({
        publicIdentity: { publicKeyZ32: "different" },
      }),
    );

    expectResultError(await createSubject().establishIdentity(CREDENTIALS, () => undefined), {
      code: "identity_mismatch",
    });
    expect(MOCKS.repositorySave).not.toHaveBeenCalled();
  });

  it("continues activation with an unconfirmed visible recovery copy", async () => {
    const diagnosticCanary = { secret: "VISIBLE-COPY-CAUSE-CANARY" };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.createVisibleRecoveryCopy.mockResolvedValue(
      Result.err({
        code: "forbidden",
        cause: diagnosticCanary,
      }),
    );

    const result = await createSubject().establishIdentity(CREDENTIALS, () => undefined);

    expect(expectResultOk(result)).toMatchObject({
      establishmentMode: "created",
      visibleRecoveryCopyStatus: "unconfirmed",
    });
    expect(MOCKS.repositorySave).toHaveBeenCalledOnce();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("VISIBLE-COPY-CAUSE-CANARY");
  });

  it.each(["create", "restore"] as const)(
    "contains a progress listener exception during %s and releases the identity key",
    async (flow) => {
      const cause = new Error("PROGRESS-LISTENER-CANARY");
      const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      MOCKS.readPassportFile.mockResolvedValue(
        Result.ok(
          flow === "create"
            ? { status: "missing" }
            : { status: "found", envelope: ENVELOPE, reference: REFERENCE },
        ),
      );

      const result = await createSubject().establishIdentity(CREDENTIALS, (progress) => {
        if (
          (progress.flow === "create" && progress.step === "signing_up") ||
          (progress.flow === "restore" && progress.step === "signing_in")
        ) {
          throw cause;
        }
      });

      expect(Result.isError(result) && result.error).toEqual({
        code: "unexpected_failure",
        cause,
      });
      expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
      expect(MOCKS.repositorySave).not.toHaveBeenCalled();
      expect(JSON.stringify(warning.mock.calls)).not.toContain("PROGRESS-LISTENER-CANARY");
    },
  );

  it("keeps visible-copy timer setup failures nonfatal and safely logged", async () => {
    const cause = { secret: "VISIBLE-COPY-SETUP-CANARY" };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    const subject = createSubject();
    vi.spyOn(globalThis, "setTimeout").mockImplementationOnce(() => {
      throw cause;
    });

    const result = await subject.establishIdentity(CREDENTIALS, () => undefined);

    expect(expectResultOk(result)).toMatchObject({
      establishmentMode: "created",
      visibleRecoveryCopyStatus: "unconfirmed",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("VISIBLE-COPY-SETUP-CANARY");
  });

  it("bounds a stalled visible recovery copy and continues activation", async () => {
    vi.useFakeTimers();
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.createVisibleRecoveryCopy.mockImplementation(
      (_envelope: unknown, _publicKey: string, signal: AbortSignal) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const pending = createSubject().establishIdentity(CREDENTIALS, () => undefined);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(expectResultOk(await pending)).toMatchObject({
      establishmentMode: "created",
      visibleRecoveryCopyStatus: "unconfirmed",
    });
  });

  it("preserves success when key cleanup throws", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.disposeIdentityKey.mockImplementationOnce(() => {
      throw new Error("SECRET-KEY-CLEANUP-CANARY");
    });

    expectResultOk(await createSubject().establishIdentity(CREDENTIALS, () => undefined));
    await vi.waitFor(() =>
      expect(warning).toHaveBeenCalledWith("identity.google.cleanup.failed", {
        operation: "created_key_dispose",
        diagnosticId: expect.any(String),
        errorName: "Error",
      }),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-KEY-CLEANUP-CANARY");
  });

  it("backs up the existing local key without creating or activating another identity", async () => {
    MOCKS.hasPassportFile.mockResolvedValue(Result.ok(false));
    const reads = recordLocalSecretReads();
    MOCKS.encryptSecretKeyBytes.mockImplementationOnce(async (key) => {
      expect(key).toEqual(new Uint8Array(32).fill(7));
      return Result.ok(ENVELOPE);
    });
    expect(
      expectResultOk(await createSubject().backupIdentity(CREDENTIALS, PUBLIC_IDENTITY)),
    ).toEqual({ visibleRecoveryCopyStatus: "created" });
    expect(MOCKS.createPassportFile).toHaveBeenCalledWith(ENVELOPE);
    expect(MOCKS.repositorySetGoogleAccount).toHaveBeenCalledWith(
      PUBLIC_IDENTITY.publicKeyZ32,
      CREDENTIALS.googleAccount,
    );
    expect(MOCKS.createIdentityKey).not.toHaveBeenCalled();
    expect(MOCKS.requestSignupToken).not.toHaveBeenCalled();
    expect(MOCKS.signin).not.toHaveBeenCalled();
    expect(MOCKS.repositorySave).not.toHaveBeenCalled();
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.decryptSecretKeyBytes).not.toHaveBeenCalled();
    expect(reads.every(isCleared)).toBe(true);
  });

  it("rejects any existing backup without reading, decrypting, or changing it", async () => {
    MOCKS.hasPassportFile.mockResolvedValue(Result.ok(true));
    expectResultError(await createSubject().backupIdentity(CREDENTIALS, PUBLIC_IDENTITY), {
      code: "google_backup_conflict",
    });
    expect(MOCKS.hasPassportFile).toHaveBeenCalledOnce();
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.requestWrappingKey).not.toHaveBeenCalled();
    expect(MOCKS.decryptSecretKeyBytes).not.toHaveBeenCalled();
    expect(MOCKS.restoreIdentityKey).not.toHaveBeenCalled();
    expect(MOCKS.encryptSecretKeyBytes).not.toHaveBeenCalled();
    expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(MOCKS.createVisibleRecoveryCopy).not.toHaveBeenCalled();
    expect(MOCKS.repositorySetGoogleAccount).not.toHaveBeenCalled();
  });

  it("does not treat a failed existence check as an empty Google account", async () => {
    const failure = { code: "forbidden", httpStatus: 403 };
    MOCKS.hasPassportFile.mockResolvedValue(Result.err(failure));
    const result = await createSubject().backupIdentity(CREDENTIALS, PUBLIC_IDENTITY);
    expect(expectResultError(result, { code: "drive_read_failed" })).toMatchObject({
      cause: failure,
    });
    expect(MOCKS.requestWrappingKey).not.toHaveBeenCalled();
    expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.repositorySetGoogleAccount).not.toHaveBeenCalled();
  });

  it("asks for the visible-copy decision only after finding the account empty", async () => {
    const credentials = { ...CREDENTIALS, visibleBackupPermissionGranted: false };
    const subject = createSubject();
    expectResultError(await subject.backupIdentity(credentials, PUBLIC_IDENTITY), {
      code: "visible_backup_permission_missing",
    });
    expect(MOCKS.hasPassportFile).toHaveBeenCalledOnce();
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.requestWrappingKey).not.toHaveBeenCalled();
    expect(MOCKS.encryptSecretKeyBytes).not.toHaveBeenCalled();
    expect(
      expectResultOk(await subject.backupIdentity(credentials, PUBLIC_IDENTITY, true)),
    ).toEqual({ visibleRecoveryCopyStatus: "skipped" });
    expect(MOCKS.hasPassportFile).toHaveBeenCalledTimes(2);
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.createVisibleRecoveryCopy).not.toHaveBeenCalled();
    expect(MOCKS.repositorySetGoogleAccount).toHaveBeenCalledOnce();
  });

  it("reports an occupied account without asking for the visible-copy decision", async () => {
    MOCKS.hasPassportFile.mockResolvedValue(Result.ok(true));

    expectResultError(
      await createSubject().backupIdentity(
        { ...CREDENTIALS, visibleBackupPermissionGranted: false },
        PUBLIC_IDENTITY,
      ),
      { code: "google_backup_conflict" },
    );
    expect(MOCKS.requestWrappingKey).not.toHaveBeenCalled();
  });

  it("reads the secret key only for encryption, after the Drive lookup", async () => {
    const reads = recordLocalSecretReads();
    MOCKS.hasPassportFile.mockImplementation(async () => {
      expect(reads.every(isCleared)).toBe(true);
      return Result.ok(false);
    });
    MOCKS.encryptSecretKeyBytes.mockImplementation(async (bytes: Uint8Array) => {
      expect(bytes).toEqual(new Uint8Array(32).fill(7));
      return Result.ok(ENVELOPE);
    });

    expectResultOk(await createSubject().backupIdentity(CREDENTIALS, PUBLIC_IDENTITY));

    expect(reads).toHaveLength(2);
    expect(reads.every(isCleared)).toBe(true);
  });

  it("never rebinds an identity already attached to another Google account", async () => {
    const reads = recordLocalSecretReads({
      ...CREDENTIALS.googleAccount,
      googleSubject: "other-account",
    });

    expectResultError(await createSubject().backupIdentity(CREDENTIALS, PUBLIC_IDENTITY), {
      code: "google_account_mismatch",
    });
    expect(MOCKS.driveStoreConstructions.count).toBe(0);
    expect(MOCKS.hasPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.requestWrappingKey).not.toHaveBeenCalled();
    expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.repositorySetGoogleAccount).not.toHaveBeenCalled();
    expect(reads.every(isCleared)).toBe(true);
  });

  it("does not touch Drive when the local identity cannot be read", async () => {
    const failure = { code: "invalid_identity" };
    MOCKS.repositoryRead.mockReturnValue(Result.err(failure));

    const error = expectResultError(
      await createSubject().backupIdentity(CREDENTIALS, PUBLIC_IDENTITY),
      { code: "local_identity_unavailable" },
    );
    expect(error.cause).toBe(failure);
    expect(MOCKS.driveStoreConstructions.count).toBe(0);
    expect(MOCKS.requestWrappingKey).not.toHaveBeenCalled();
  });

  it("writes nothing when the local key disappears before encryption", async () => {
    const reads = recordLocalSecretReads();
    const read = MOCKS.repositoryRead.getMockImplementation();
    MOCKS.repositoryRead
      .mockImplementationOnce((...args: unknown[]) => read?.(...args))
      .mockReturnValue(Result.err({ code: "storage_unavailable" }));

    expectResultError(await createSubject().backupIdentity(CREDENTIALS, PUBLIC_IDENTITY), {
      code: "local_identity_unavailable",
    });
    expect(MOCKS.encryptSecretKeyBytes).not.toHaveBeenCalled();
    expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
    expect(reads.every(isCleared)).toBe(true);
  });

  it.each([
    [
      "the wrapping key request fails",
      "wrapping_key_failed",
      () => MOCKS.requestWrappingKey.mockResolvedValue(Result.err({ code: "network_failed" })),
    ],
    [
      "encryption fails",
      "encrypt_failed",
      () => MOCKS.encryptSecretKeyBytes.mockResolvedValue(Result.err({ code: "encrypt_failed" })),
    ],
    [
      "encryption throws",
      "unexpected_failure",
      () => MOCKS.encryptSecretKeyBytes.mockRejectedValue(new Error("ENCRYPT-THROW")),
    ],
    [
      "the Drive write fails",
      "drive_write_failed",
      () => MOCKS.createPassportFile.mockResolvedValue(Result.err({ code: "write_failed" })),
    ],
    [
      "the account is occupied",
      "google_backup_conflict",
      () => MOCKS.hasPassportFile.mockResolvedValue(Result.ok(true)),
    ],
    [
      "the link cannot be saved",
      "google_backup_created_not_linked",
      () =>
        MOCKS.repositorySetGoogleAccount.mockReturnValue(
          Result.err({ code: "storage_unavailable" }),
        ),
    ],
  ] as const)("clears every secret read when %s", async (_label, code, arrange) => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const reads = recordLocalSecretReads();
    arrange();

    expectResultError(await createSubject().backupIdentity(CREDENTIALS, PUBLIC_IDENTITY), {
      code,
    });
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every(isCleared)).toBe(true);
  });

  it("contains an unexpected failure during backup without logging its details", async () => {
    const thrown = new Error("BACKUP-THROW-CANARY");
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.hasPassportFile.mockRejectedValue(thrown);

    const failure = expectResultError(
      await createSubject().backupIdentity(CREDENTIALS, PUBLIC_IDENTITY),
      { code: "unexpected_failure" },
    );
    expect(failure.cause).toBe(thrown);
    expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("BACKUP-THROW-CANARY");
  });

  it("keeps the Google association unchanged if backup creation races another writer", async () => {
    MOCKS.hasPassportFile.mockResolvedValue(Result.ok(false));
    MOCKS.createPassportFile.mockResolvedValue(Result.err({ code: "create_conflict" }));
    expectResultError(await createSubject().backupIdentity(CREDENTIALS, PUBLIC_IDENTITY), {
      code: "drive_create_conflict",
    });
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.repositorySetGoogleAccount).not.toHaveBeenCalled();
  });

  it("retries local linking once and preserves the remote backup when it still fails", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.hasPassportFile.mockResolvedValue(Result.ok(false));
    const linkFailure = { code: "storage_unavailable", cause: new Error("LINK-CAUSE-CANARY") };
    MOCKS.repositorySetGoogleAccount.mockReturnValue(Result.err(linkFailure));
    const failure = expectResultError(
      await createSubject().backupIdentity(CREDENTIALS, PUBLIC_IDENTITY),
      { code: "google_backup_created_not_linked" },
    );
    expect(failure.cause).toBe(linkFailure);
    expect(MOCKS.createPassportFile).toHaveBeenCalledOnce();
    expect(MOCKS.repositorySetGoogleAccount).toHaveBeenCalledTimes(2);
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("LINK-CAUSE-CANARY");
  });

  it("links a backup it created earlier without opening it, once local storage recovers", async () => {
    MOCKS.hasPassportFile.mockResolvedValue(Result.ok(false));
    MOCKS.createVisibleRecoveryCopy.mockResolvedValue(Result.err({ code: "create_failed" }));
    MOCKS.repositorySetGoogleAccount.mockReturnValue(Result.err({ code: "storage_unavailable" }));
    const subject = createSubject();
    expectResultError(await subject.backupIdentity(CREDENTIALS, PUBLIC_IDENTITY), {
      code: "google_backup_created_not_linked",
    });

    MOCKS.hasPassportFile.mockResolvedValue(Result.ok(true));
    MOCKS.repositorySetGoogleAccount.mockReturnValue(Result.ok());
    expect(expectResultOk(await subject.backupIdentity(CREDENTIALS, PUBLIC_IDENTITY))).toEqual({
      visibleRecoveryCopyStatus: "unconfirmed",
    });
    expect(MOCKS.createPassportFile).toHaveBeenCalledOnce();
    expect(MOCKS.encryptSecretKeyBytes).toHaveBeenCalledOnce();
    expect(MOCKS.requestWrappingKey).toHaveBeenCalledOnce();
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.decryptSecretKeyBytes).not.toHaveBeenCalled();
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(MOCKS.repositorySetGoogleAccount).toHaveBeenLastCalledWith(
      PUBLIC_IDENTITY.publicKeyZ32,
      CREDENTIALS.googleAccount,
    );

    // Once linked, an existing file for the same account is an ordinary conflict again.
    expectResultError(await subject.backupIdentity(CREDENTIALS, PUBLIC_IDENTITY), {
      code: "google_backup_conflict",
    });
  });

  it("does not claim an existing backup for another identity or Google account", async () => {
    MOCKS.hasPassportFile.mockResolvedValue(Result.ok(false));
    MOCKS.repositorySetGoogleAccount.mockReturnValue(Result.err({ code: "storage_unavailable" }));
    const subject = createSubject();
    expectResultError(await subject.backupIdentity(CREDENTIALS, PUBLIC_IDENTITY), {
      code: "google_backup_created_not_linked",
    });
    MOCKS.hasPassportFile.mockResolvedValue(Result.ok(true));
    MOCKS.repositorySetGoogleAccount.mockReturnValue(Result.ok());

    expectResultError(
      await subject.backupIdentity(CREDENTIALS, { publicKeyZ32: "other-identity" }),
      { code: "google_backup_conflict" },
    );
    expectResultError(
      await subject.backupIdentity(
        {
          ...CREDENTIALS,
          googleAccount: { ...CREDENTIALS.googleAccount, googleSubject: "other-account" },
        },
        PUBLIC_IDENTITY,
      ),
      { code: "google_backup_conflict" },
    );
    // A reloaded page has no record of the unlinked backup, so it stays unclaimed there.
    expectResultError(
      await createSubject({ unlinkedBackups: new Map() }).backupIdentity(
        CREDENTIALS,
        PUBLIC_IDENTITY,
      ),
      { code: "google_backup_conflict" },
    );
    expect(MOCKS.repositorySetGoogleAccount).toHaveBeenCalledTimes(2);
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
  });

  it("links an unlinked backup from a later screen's lifecycle on the same page", async () => {
    // Both lifecycles use the production default record, as separate screens on one page do.
    MOCKS.repositorySetGoogleAccount.mockReturnValue(Result.err({ code: "storage_unavailable" }));
    const first = createPageScopedSubject();
    expectResultError(await first.backupIdentity(CREDENTIALS, PUBLIC_IDENTITY), {
      code: "google_backup_created_not_linked",
    });
    first.dispose();

    MOCKS.hasPassportFile.mockResolvedValue(Result.ok(true));
    MOCKS.repositorySetGoogleAccount.mockReturnValue(Result.ok());
    const later = createPageScopedSubject();
    // Linking removes the entry, so no page-scoped state outlives this test.
    expect(expectResultOk(await later.backupIdentity(CREDENTIALS, PUBLIC_IDENTITY))).toEqual({
      visibleRecoveryCopyStatus: "created",
    });
    expect(MOCKS.createPassportFile).toHaveBeenCalledOnce();
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
    expectResultError(await later.backupIdentity(CREDENTIALS, PUBLIC_IDENTITY), {
      code: "google_backup_conflict",
    });
    later.dispose();
  });

  it("verifies Drive files before deletion and clears only the Google association last", async () => {
    const events: string[] = [];
    foundPassportFile();
    const localSecret = boundLocalIdentity();
    record(MOCKS.deleteVisibleRecoveryCopies, "visible-delete", events);
    record(MOCKS.deletePassportFile, "app-data-delete", events);
    MOCKS.repositorySetGoogleAccount.mockImplementation(() => {
      events.push("unlink-google");
      return Result.ok();
    });

    const result = await createSubject().detachIdentity(
      CREDENTIALS,
      PUBLIC_IDENTITY,
      CREDENTIALS.googleAccount.googleSubject,
    );

    expect(expectResultOk(result)).toBeUndefined();
    expect(events).toEqual(["visible-delete", "app-data-delete", "unlink-google"]);
    expect(MOCKS.repositoryRead).toHaveBeenCalledWith(PUBLIC_IDENTITY.publicKeyZ32);
    expect(localSecret).toEqual(new Uint8Array(32));
    expect(MOCKS.repositorySetGoogleAccount).toHaveBeenCalledWith(
      PUBLIC_IDENTITY.publicKeyZ32,
      undefined,
    );
    expect(MOCKS.driveStoreConstructions.count).toBe(1);
    expect(MOCKS.visibleCopiesConstructions.count).toBe(1);
    expect(MOCKS.deletePassportFile).toHaveBeenCalledWith(REFERENCE);
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
  });

  it("deletes visible copies and clears the Google association when app-data is missing", async () => {
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    boundLocalIdentity();
    const remove = MOCKS.repositorySetGoogleAccount;

    expect(
      expectResultOk(
        await createSubject().detachIdentity(
          CREDENTIALS,
          PUBLIC_IDENTITY,
          CREDENTIALS.googleAccount.googleSubject,
        ),
      ),
    ).toBeUndefined();
    expect(MOCKS.deleteVisibleRecoveryCopies).toHaveBeenCalledOnce();
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(PUBLIC_IDENTITY.publicKeyZ32, undefined);
  });

  it("keeps app-data and the local identity when visible-copy deletion fails", async () => {
    const diagnosticCanary = { secret: "DRIVE-CLEANUP-CAUSE-CANARY" };
    const lowerFailure = { code: "delete_failed", cause: diagnosticCanary };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    foundPassportFile();
    boundLocalIdentity();
    MOCKS.deleteVisibleRecoveryCopies.mockResolvedValue(Result.err(lowerFailure));
    const remove = MOCKS.repositorySetGoogleAccount;

    const failure = expectResultError(
      await createSubject().detachIdentity(
        CREDENTIALS,
        PUBLIC_IDENTITY,
        CREDENTIALS.googleAccount.googleSubject,
      ),
      { code: "google_drive_cleanup_failed" },
    );
    expect(failure.cause).toBe(lowerFailure);
    expect(JSON.stringify(warning.mock.calls)).not.toContain("DRIVE-CLEANUP-CAUSE-CANARY");
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not delete Drive files when the local identity is missing or unbound", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    foundPassportFile();
    MOCKS.repositoryRead.mockReturnValue(Result.err({ code: "invalid_identity" }));

    expectResultError(
      await createSubject().detachIdentity(
        CREDENTIALS,
        PUBLIC_IDENTITY,
        CREDENTIALS.googleAccount.googleSubject,
      ),
      { code: "local_identity_unavailable" },
    );

    const bytes = new Uint8Array(32).fill(7);
    MOCKS.repositoryRead.mockReturnValue(
      Result.ok({
        identity: {
          publicIdentity: PUBLIC_IDENTITY,
          googleAccount: { ...CREDENTIALS.googleAccount, googleSubject: "other-account" },
        },
        secretKey: { bytes, format: "pubky-secret-key" },
      }),
    );
    expectResultError(
      await createSubject().detachIdentity(
        CREDENTIALS,
        PUBLIC_IDENTITY,
        CREDENTIALS.googleAccount.googleSubject,
      ),
      { code: "local_identity_not_bound" },
    );

    expect(bytes).toEqual(new Uint8Array(32));
    expect(warning).toHaveBeenCalledWith("identity.google.local_identity.failed", {
      code: "local_identity_unavailable",
      localCode: "invalid_identity",
    });
    expect(warning).toHaveBeenCalledWith("identity.google.detach.failed", {
      stage: "local_identity",
      code: "local_identity_not_bound",
    });
    expect(MOCKS.driveStoreConstructions.count).toBe(0);
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(MOCKS.deleteVisibleRecoveryCopies).not.toHaveBeenCalled();
    expect(MOCKS.repositorySetGoogleAccount).not.toHaveBeenCalled();
  });

  it("forgets an unlinked backup once detachment deletes it", async () => {
    MOCKS.repositorySetGoogleAccount.mockReturnValue(Result.err({ code: "storage_unavailable" }));
    expectResultError(await createSubject().backupIdentity(CREDENTIALS, PUBLIC_IDENTITY), {
      code: "google_backup_created_not_linked",
    });

    // Linked meanwhile through Google sign-in, the identity is then detached on the same page.
    MOCKS.repositorySetGoogleAccount.mockReturnValue(Result.ok());
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    boundLocalIdentity();
    expectResultOk(
      await createSubject().detachIdentity(
        CREDENTIALS,
        PUBLIC_IDENTITY,
        CREDENTIALS.googleAccount.googleSubject,
      ),
    );

    // A backup that appears in the account afterwards is not this page's to claim.
    recordLocalSecretReads();
    MOCKS.hasPassportFile.mockResolvedValue(Result.ok(true));
    expectResultError(await createSubject().backupIdentity(CREDENTIALS, PUBLIC_IDENTITY), {
      code: "google_backup_conflict",
    });
  });

  it("reports a failed local unlink after the Drive files were removed", async () => {
    foundPassportFile();
    boundLocalIdentity();
    const failure = { code: "storage_unavailable" };
    MOCKS.repositorySetGoogleAccount.mockReturnValue(Result.err(failure));

    const error = expectResultError(
      await createSubject().detachIdentity(
        CREDENTIALS,
        PUBLIC_IDENTITY,
        CREDENTIALS.googleAccount.googleSubject,
      ),
      { code: "local_unlink_failed" },
    );
    expect(error.cause).toBe(failure);
    expect(MOCKS.deleteVisibleRecoveryCopies).toHaveBeenCalledOnce();
    expect(MOCKS.deletePassportFile).toHaveBeenCalledWith(REFERENCE);
    expect(MOCKS.repositorySave).not.toHaveBeenCalled();
  });

  it("does not access Drive when detachment authorizes a different Google account", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const remove = MOCKS.repositorySetGoogleAccount;

    expectResultError(
      await createSubject().detachIdentity(
        CREDENTIALS,
        PUBLIC_IDENTITY,
        "different-google-account",
      ),
      { code: "google_account_mismatch" },
    );
    expect(warning).toHaveBeenCalledWith("identity.google.detach.failed", {
      stage: "account_binding",
      code: "google_account_mismatch",
    });
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("disposes the shared Pubky adapter once", () => {
    const subject = createSubject();

    subject.dispose();
    subject.dispose();

    expect(MOCKS.disposePubky).toHaveBeenCalledOnce();
  });

  it("aborts credential-bearing fetches when the screen controller is disposed", async () => {
    let requestSignal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_request, init) => {
        requestSignal = init?.signal;
        return new Response("{}", { status: 200 });
      }),
    );
    const subject = createSubject();
    void subject.establishIdentity(CREDENTIALS, () => undefined);
    await vi.waitFor(() => expect(MOCKS.contextFetch.current).toBeDefined());
    const fetchWithDeadline = MOCKS.contextFetch.current;
    if (!fetchWithDeadline) throw new Error("Expected the context fetch function");

    await fetchWithDeadline("/test");
    expect(requestSignal?.aborted).toBe(false);

    subject.abortRequests();
    expect(requestSignal?.aborted).toBe(true);
  });

  it("adds the network timeout only to requests whose client passes no signal", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const subject = createSubject();
    void subject.establishIdentity(CREDENTIALS, () => undefined);
    await vi.waitFor(() => expect(MOCKS.contextFetch.current).toBeDefined());
    const fetchWithDeadline = MOCKS.contextFetch.current;
    if (!fetchWithDeadline) throw new Error("Expected the context fetch function");
    timeout.mockClear();

    await fetchWithDeadline("/without-signal");
    expect(timeout).toHaveBeenCalledWith(NETWORK_OPERATION_TIMEOUT_MS);

    timeout.mockClear();
    const clientTimeout = AbortSignal.timeout(1_000);
    timeout.mockClear();
    await fetchWithDeadline("/with-signal", { signal: clientTimeout });
    expect(timeout).not.toHaveBeenCalled();

    subject.dispose();
  });
});

function createSubject(
  overrides: Partial<GoogleIdentityLifecycleDependencies> = {},
): GoogleIdentityLifecycle {
  return createPageScopedSubject({ unlinkedBackups: MOCKS.unlinkedBackups, ...overrides });
}

/**
 * Like {@link createSubject}, but without `unlinkedBackups` it uses the production page record.
 * Unspent invites always use the test's record.
 */
function createPageScopedSubject(
  overrides: Partial<GoogleIdentityLifecycleDependencies> = {},
): GoogleIdentityLifecycle {
  return new GoogleIdentityLifecycle("https://homegate.example/", "https://passport.pubky.app", {
    pubky: {
      createIdentityKey: MOCKS.createIdentityKey,
      exportSecretKey: MOCKS.exportSecretKey,
      restoreIdentityKey: MOCKS.restoreIdentityKey,
      signup: MOCKS.signup,
      signin: MOCKS.signin,
      resolveHomeserver: MOCKS.resolveHomeserver,
      publishHomeserver: MOCKS.publishHomeserver,
      disposeIdentityKey: MOCKS.disposeIdentityKey,
      dispose: MOCKS.disposePubky,
    },
    crypto: {
      encryptSecretKeyBytes: MOCKS.encryptSecretKeyBytes,
      decryptSecretKeyBytes: MOCKS.decryptSecretKeyBytes,
    },
    repository: {
      save: MOCKS.repositorySave,
      setGoogleAccount: MOCKS.repositorySetGoogleAccount,
      read: MOCKS.repositoryRead,
    },
    wrappingKeys: {
      requestGoogleWrappingKey: MOCKS.requestWrappingKey,
    },
    homegate: {
      requestGoogleSignupToken: MOCKS.requestSignupToken,
    },
    signupTokens: {
      lookUp: MOCKS.lookUpSignupToken,
    },
    unspentSignupInvites: MOCKS.unspentSignupInvites,
    createDriveStore: (_driveAccessToken, fetchImpl) => {
      MOCKS.driveStoreConstructions.count += 1;
      MOCKS.contextFetch.current = fetchImpl;
      return {
        hasPassportFile: MOCKS.hasPassportFile,
        createPassportFile: MOCKS.createPassportFile,
        deleteInvalidPassportFile: MOCKS.deleteInvalidPassportFile,
        deletePassportFile: MOCKS.deletePassportFile,
        readPassportFile: MOCKS.readPassportFile,
      };
    },
    createVisibleRecoveryCopies: () => {
      MOCKS.visibleCopiesConstructions.count += 1;
      return {
        createVisibleRecoveryCopy: MOCKS.createVisibleRecoveryCopy,
        deleteVisibleRecoveryCopies: MOCKS.deleteVisibleRecoveryCopies,
      };
    },
    ...overrides,
  });
}

/** Serves a fresh secret for PUBLIC_IDENTITY on every local read and returns each one read. */
function recordLocalSecretReads(googleAccount?: typeof CREDENTIALS.googleAccount): Uint8Array[] {
  const reads: Uint8Array[] = [];
  MOCKS.repositoryRead.mockImplementation(() => {
    const bytes = new Uint8Array(32).fill(7);
    reads.push(bytes);
    return Result.ok({
      identity: { publicIdentity: PUBLIC_IDENTITY, ...(googleAccount ? { googleAccount } : {}) },
      secretKey: { bytes, format: "pubky-secret-key" },
    });
  });
  return reads;
}

function isCleared(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0);
}

/** Local record for PUBLIC_IDENTITY bound to the Google account in CREDENTIALS; returns its secret. */
function boundLocalIdentity(): Uint8Array {
  const bytes = new Uint8Array(32).fill(7);
  MOCKS.repositoryRead.mockImplementation(() =>
    Result.ok({
      identity: { publicIdentity: PUBLIC_IDENTITY, googleAccount: CREDENTIALS.googleAccount },
      secretKey: { bytes, format: "pubky-secret-key" },
    }),
  );
  return bytes;
}

function foundPassportFile(envelope: typeof ENVELOPE = ENVELOPE): void {
  MOCKS.readPassportFile.mockResolvedValue(
    Result.ok({
      status: "found",
      envelope,
      reference: REFERENCE,
    }),
  );
}

function record(mock: ReturnType<typeof vi.fn>, event: string, events: string[]): void {
  const implementation = mock.getMockImplementation() as
    ((...args: unknown[]) => unknown) | undefined;
  mock.mockImplementation(async (...args: unknown[]) => {
    events.push(event);
    return implementation?.(...args);
  });
}

function expectResultError<Success, Failure extends { code: string }>(
  result: ResultType<Success, Failure>,
  expected: { code: Failure["code"]; detailCode?: string },
): Failure {
  expect(Result.isError(result)).toBe(true);
  if (!Result.isError(result)) throw new Error("Expected an error Result");
  expect(result.error.code).toBe(expected.code);
  if (expected.detailCode !== undefined) {
    expect((result.error as Failure & { detailCode?: string }).detailCode).toBe(
      expected.detailCode,
    );
  }
  return result.error;
}
