/** @vitest-environment jsdom */

import { Result, type Result as ResultType } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../../test-utils/MemoryStorage";
import { expectResultOk } from "../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../libs/logger/logger";
import { LocalStorageIdentityRepository } from "../local-identity/LocalStorageIdentityRepository";

const MOCKS = vi.hoisted(() => ({
  PubkySdkAdapter: vi.fn(),
  createIdentityKey: vi.fn(),
  exportSecretKey: vi.fn(),
  restoreIdentityKey: vi.fn(),
  signup: vi.fn(),
  signin: vi.fn(),
  resolveHomeserver: vi.fn(),
  publishHomeserver: vi.fn(),
  disposeIdentityKey: vi.fn(),
  disposePubky: vi.fn(),
  GoogleWrappingKeyApiClient: vi.fn(),
  requestWrappingKey: vi.fn(),
  HomegateClient: vi.fn(),
  requestInvitation: vi.fn(),
  PassportFileWebCrypto: vi.fn(),
  encryptSecretKeyBytes: vi.fn(),
  decryptSecretKeyBytes: vi.fn(),
  repositorySave: vi.fn(),
  driveStoreConstructions: { count: 0 },
  visibleCopiesConstructions: { count: 0 },
  readPassportFile: vi.fn(),
  deleteInvalidPassportFile: vi.fn(),
  createPassportFile: vi.fn(),
  deletePassportFile: vi.fn(),
  createVisibleRecoveryCopy: vi.fn(),
  deleteVisibleRecoveryCopies: vi.fn(),
}));

vi.mock("../pubky/PubkySdkAdapter", () => ({
  PubkySdkAdapter: MOCKS.PubkySdkAdapter,
}));
vi.mock("../wrapping-key/GoogleWrappingKeyApiClient", () => ({ GoogleWrappingKeyApiClient: MOCKS.GoogleWrappingKeyApiClient }));
vi.mock("../homegate/HomegateClient", () => ({ HomegateClient: MOCKS.HomegateClient }));
vi.mock("../passport-file/PassportFileWebCrypto", () => ({ PassportFileWebCrypto: MOCKS.PassportFileWebCrypto }));
vi.mock("../passport-file/google/GoogleDrivePassportFileStore", () => ({
  GoogleDrivePassportFileStore: class {
    constructor() {
      MOCKS.driveStoreConstructions.count += 1;
    }

    readPassportFile = MOCKS.readPassportFile;
    deleteInvalidPassportFile = MOCKS.deleteInvalidPassportFile;
    createPassportFile = MOCKS.createPassportFile;
    deletePassportFile = MOCKS.deletePassportFile;
  },
}));
vi.mock("../passport-file/google/GoogleDriveVisibleRecoveryCopies", () => ({
  GoogleDriveVisibleRecoveryCopies: class {
    constructor() {
      MOCKS.visibleCopiesConstructions.count += 1;
    }

    createVisibleRecoveryCopy = MOCKS.createVisibleRecoveryCopy;
    deleteVisibleRecoveryCopies = MOCKS.deleteVisibleRecoveryCopies;
  },
}));

import { GoogleIdentityOperations, type GoogleIdentityProgress } from "./GoogleIdentityOperations";

const PUBLIC_IDENTITY = {
  publicKeyZ32: "public-identity",
  publicKeyDisplay: "pubkypublic-identity",
};
const KEY_HANDLE = {};
const IDENTITY = { keyHandle: KEY_HANDLE, publicIdentity: PUBLIC_IDENTITY };
const ENVELOPE = {
  v: 1 as const,
  iv: "a".repeat(16),
  ct: "b".repeat(64),
  url: "https://passport.pubky.app",
};
const REFERENCE = { storageId: "opaque-file-id", revision: "42" };
const CREDENTIALS = {
  googleIdToken: "google-id-token",
  driveAccessToken: "drive-access-token",
  googleAccount: {
    googleSubject: "google-account",
    email: "user@example.com",
    name: "User",
    pictureUrl: null,
  },
};
const INVITATION = {
  homeserverPubky: "homeserver-pubky",
  signupCode: "signup-code",
};

describe("GoogleIdentityOperations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MOCKS.driveStoreConstructions.count = 0;
    MOCKS.visibleCopiesConstructions.count = 0;
    vi.stubGlobal("localStorage", new MemoryStorage());
    MOCKS.PubkySdkAdapter.mockImplementation(function () {
      return {
        createIdentityKey: MOCKS.createIdentityKey,
        exportSecretKey: MOCKS.exportSecretKey,
        restoreIdentityKey: MOCKS.restoreIdentityKey,
        signup: MOCKS.signup,
        signin: MOCKS.signin,
        resolveHomeserver: MOCKS.resolveHomeserver,
        publishHomeserver: MOCKS.publishHomeserver,
        disposeIdentityKey: MOCKS.disposeIdentityKey,
        dispose: MOCKS.disposePubky,
      };
    });
    MOCKS.GoogleWrappingKeyApiClient.mockImplementation(function () {
      return { requestGoogleWrappingKey: MOCKS.requestWrappingKey };
    });
    MOCKS.HomegateClient.mockImplementation(function () {
      return { requestGoogleHomeserverSignupInvitation: MOCKS.requestInvitation };
    });
    MOCKS.PassportFileWebCrypto.mockImplementation(function () {
      return {
        encryptSecretKeyBytes: MOCKS.encryptSecretKeyBytes,
        decryptSecretKeyBytes: MOCKS.decryptSecretKeyBytes,
      };
    });
    MOCKS.requestWrappingKey.mockResolvedValue(Result.ok("w".repeat(43)));
    MOCKS.requestInvitation.mockResolvedValue(Result.ok(INVITATION));
    MOCKS.createIdentityKey.mockResolvedValue(Result.ok(IDENTITY));
    MOCKS.exportSecretKey.mockImplementation(async () => Result.ok({
      bytes: new Uint8Array(32).fill(7),
      format: "pubky-secret-key",
    }));
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
    MOCKS.repositorySave.mockReturnValue(Result.ok({
      publicIdentity: PUBLIC_IDENTITY,
    }));
    vi.spyOn(LocalStorageIdentityRepository.prototype, "save")
      .mockImplementation(MOCKS.repositorySave);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates, stores, signs up, publishes, verifies, and saves a missing identity in order", async () => {
    const events: string[] = [];
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    record(MOCKS.requestInvitation, "homegate", events);
    record(MOCKS.createIdentityKey, "create-key", events);
    record(MOCKS.createPassportFile, "drive-create", events);
    record(MOCKS.createVisibleRecoveryCopy, "visible-copy", events);
    record(MOCKS.signup, "signup", events);
    record(MOCKS.publishHomeserver, "publish-if-stale", events);
    record(MOCKS.signin, "signin", events);
    record(MOCKS.repositorySave, "save", events);
    const progress: GoogleIdentityProgress[] = [];

    const result = await createSubject().establishIdentity(CREDENTIALS, (phase) => progress.push(phase));

    expect(expectResultOk(result)).toEqual({
      establishmentMode: "created",
      publicIdentity: PUBLIC_IDENTITY,
      visibleRecoveryCopyStatus: "created",
    });
    expect(events).toEqual([
      "homegate",
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
      { flow: "create", step: "publishing" },
      { flow: "create", step: "activating" },
    ]);
    expect(MOCKS.driveStoreConstructions.count).toBe(1);
    expect(MOCKS.visibleCopiesConstructions.count).toBe(1);
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
  });

  it("clears the exported secret before waiting on the Drive write", async () => {
    const exportedBytes = new Uint8Array(32).fill(7);
    let finishDriveWrite!: () => void;
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.exportSecretKey.mockResolvedValueOnce(Result.ok({
      bytes: exportedBytes,
      format: "pubky-secret-key",
    }));
    MOCKS.createPassportFile.mockImplementationOnce(() => new Promise((resolve) => {
      finishDriveWrite = () => resolve(Result.ok());
    }));

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
      MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.err({ code: "decrypt_failed" }));
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
    if (stage === "wrapping-key") expect(MOCKS.requestInvitation).not.toHaveBeenCalled();
  });

  it("preserves the entire translated lower failure as the diagnostic cause", async () => {
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

  it("preserves broad-catch identity without logging thrown details", async () => {
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

  it("exposes malformed passport files as a specific recoverable error", async () => {
    MOCKS.readPassportFile.mockResolvedValue(Result.err({ code: "invalid_file" }));

    expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, () => undefined),
      { code: "invalid_passport_file" },
    );
    expect(MOCKS.requestWrappingKey).not.toHaveBeenCalled();
  });

  it.each(["deleted", "missing"] as const)("automatically creates a new identity after the invalid file is %s", async (deletionStatus) => {
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

  it("restores through normal sign-in without publishing or requesting Homegate", async () => {
    const decryptedBytes = new Uint8Array(32).fill(9);
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({
      status: "found",
      envelope: ENVELOPE,
      reference: REFERENCE,
    }));
    MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.ok(decryptedBytes));
    const progress: GoogleIdentityProgress[] = [];

    const result = await createSubject().establishIdentity(CREDENTIALS, (phase) => progress.push(phase));

    expect(expectResultOk(result)).toEqual({
      establishmentMode: "restored",
      publicIdentity: PUBLIC_IDENTITY,
    });
    expect(MOCKS.requestInvitation).not.toHaveBeenCalled();
    expect(MOCKS.signup).not.toHaveBeenCalled();
    expect(MOCKS.publishHomeserver).not.toHaveBeenCalled();
    expect(MOCKS.signin).toHaveBeenCalledWith(KEY_HANDLE);
    expect(MOCKS.resolveHomeserver).not.toHaveBeenCalled();
    expect(decryptedBytes).toEqual(new Uint8Array(32));
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
    expect(progress).toEqual([
      { flow: "lookup", step: "checking" },
      { flow: "restore", step: "restoring" },
      { flow: "restore", step: "signing_in" },
    ]);
  });

  it("does not request another invitation when an established identity sign-in fails", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValue(Result.err({ code: "signin_failed" }));
    MOCKS.resolveHomeserver.mockResolvedValue(Result.ok("existing-homeserver"));

    expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, () => undefined),
      { code: "signin_failed" },
    );

    expect(MOCKS.resolveHomeserver).toHaveBeenCalledWith(PUBLIC_IDENTITY.publicKeyZ32);
    expect(MOCKS.requestInvitation).not.toHaveBeenCalled();
    expect(MOCKS.signup).not.toHaveBeenCalled();
    expect(MOCKS.publishHomeserver).not.toHaveBeenCalled();
  });

  it("does not request an invitation when homeserver resolution is uncertain", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValue(Result.err({ code: "signin_failed" }));
    MOCKS.resolveHomeserver.mockResolvedValue(Result.err({ code: "resolution_failed" }));

    expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, () => undefined),
      { code: "signin_failed" },
    );

    expect(MOCKS.requestInvitation).not.toHaveBeenCalled();
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
    record(MOCKS.requestInvitation, "homegate", events);
    record(MOCKS.signup, "signup", events);
    record(MOCKS.repositorySave, "save", events);
    const progress: GoogleIdentityProgress[] = [];

    expectResultOk(await createSubject().establishIdentity(CREDENTIALS, (phase) => progress.push(phase)));

    expect(MOCKS.requestInvitation).toHaveBeenCalledWith(CREDENTIALS.googleIdToken);
    expect(MOCKS.resolveHomeserver).toHaveBeenCalledWith(PUBLIC_IDENTITY.publicKeyZ32);
    expect(events).toEqual([
      "signin",
      "homegate",
      "signup",
      "publish-if-stale",
      "signin",
      "save",
    ]);
    expect(MOCKS.signup).toHaveBeenCalledWith(
      KEY_HANDLE,
      INVITATION.homeserverPubky,
      INVITATION.signupCode,
    );
    expect(MOCKS.publishHomeserver).toHaveBeenCalledWith(
      KEY_HANDLE,
      INVITATION.homeserverPubky,
    );
    expect(MOCKS.signin).toHaveBeenNthCalledWith(1, KEY_HANDLE);
    expect(MOCKS.signin).toHaveBeenNthCalledWith(2, KEY_HANDLE, {
      waitForPkdnsPublication: true,
    });
    expect(MOCKS.repositorySave).toHaveBeenCalledOnce();
    expect(progress).toEqual([
      { flow: "lookup", step: "checking" },
      { flow: "restore", step: "restoring" },
      { flow: "restore", step: "signing_in" },
      { flow: "repair", step: "signing_up" },
      { flow: "repair", step: "publishing" },
      { flow: "repair", step: "signing_in" },
    ]);
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

  it("reports repair before requesting a replacement homeserver invitation", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }));
    const events: Array<string | GoogleIdentityProgress> = [];
    MOCKS.requestInvitation.mockImplementation(async () => {
      events.push("homegate");
      return Result.err({ code: "network_failed" });
    });

    expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, (phase) => events.push(phase)),
      { code: "homeserver_signup_invitation_failed", detailCode: "network_failed" },
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

    expectResultOk(await createSubject().establishIdentity(CREDENTIALS, (phase) => progress.push(phase)));

    expect(progress.at(-1)).toEqual({ flow: "repair", step: "signing_in" });
    expect(MOCKS.repositorySave).toHaveBeenCalledOnce();
  });

  it("fails publication when uncertain repaired publication cannot be verified by sign-in", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValue(Result.err({ code: "signin_failed" }));
    MOCKS.publishHomeserver.mockResolvedValueOnce(Result.err({ code: "publish_failed" }));

    expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, () => undefined),
      { code: "publication_failed" },
    );

    expect(MOCKS.signin).toHaveBeenCalledTimes(2);
    expect(MOCKS.repositorySave).not.toHaveBeenCalled();
  });

  it("does not verify a definitive repaired publication failure through sign-in", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValueOnce(Result.err({ code: "signin_failed" }));
    MOCKS.publishHomeserver.mockResolvedValueOnce(Result.err({ code: "invalid_homeserver_pubky" }));

    expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, () => undefined),
      { code: "publication_failed" },
    );

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
    MOCKS.signin
      .mockResolvedValueOnce(Result.err({ code: "signin_failed" }))
      .mockResolvedValue(Result.ok({
        publicIdentity: { publicKeyZ32: "different", publicKeyDisplay: "pubkydifferent" },
      }));

    expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, () => undefined),
      { code: "identity_mismatch" },
    );

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

    expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, () => undefined),
      { code: "signup_failed" },
    );
    expect(MOCKS.publishHomeserver).not.toHaveBeenCalled();
    expect(MOCKS.repositorySave).not.toHaveBeenCalled();
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
  });

  it.each([
    ["publication", "publication_failed"],
    ["signin", "signin_failed"],
    ["local-save", "local_save_failed"],
  ] as const)("stops and disposes the key after a %s failure", async (stage, expectedCode) => {
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    if (stage === "publication") {
      MOCKS.publishHomeserver.mockResolvedValue(Result.err({ code: "publish_failed" }));
      MOCKS.signin.mockResolvedValue(Result.err({ code: "signin_failed" }));
    } else if (stage === "signin") {
      MOCKS.signin.mockResolvedValue(Result.err({ code: "signin_failed" }));
    } else {
      MOCKS.repositorySave.mockReturnValue(Result.err({ code: "storage_unavailable" }));
    }

    expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, () => undefined),
      { code: expectedCode },
    );
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
  });

  it("relies on the Pubky adapter to clear decrypted bytes when key restoration fails", async () => {
    const decryptedBytes = new Uint8Array(32).fill(9);
    foundPassportFile();
    MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.ok(decryptedBytes));
    MOCKS.restoreIdentityKey.mockImplementation(async (secretKey: { bytes: Uint8Array }) => {
      secretKey.bytes.fill(0);
      return Result.err({ code: "restore_failed" });
    });

    expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, () => undefined),
      { code: "restore_failed" },
    );
    expect(decryptedBytes).toEqual(new Uint8Array(32));
  });

  it("rejects a mismatched sign-in identity before local persistence", async () => {
    foundPassportFile();
    MOCKS.signin.mockResolvedValue(Result.ok({
      publicIdentity: { publicKeyZ32: "different", publicKeyDisplay: "pubkydifferent" },
    }));

    expectResultError(
      await createSubject().establishIdentity(CREDENTIALS, () => undefined),
      { code: "identity_mismatch" },
    );
    expect(MOCKS.repositorySave).not.toHaveBeenCalled();
  });

  it("continues activation with an unconfirmed visible recovery copy", async () => {
    const diagnosticCanary = { secret: "VISIBLE-COPY-CAUSE-CANARY" };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.createVisibleRecoveryCopy.mockResolvedValue(Result.err({
      code: "forbidden",
      cause: diagnosticCanary,
    }));

    const result = await createSubject().establishIdentity(CREDENTIALS, () => undefined);

    expect(expectResultOk(result)).toMatchObject({
      establishmentMode: "created",
      visibleRecoveryCopyStatus: "unconfirmed",
    });
    expect(MOCKS.repositorySave).toHaveBeenCalledOnce();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("VISIBLE-COPY-CAUSE-CANARY");
  });

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
      (_envelope: unknown, _publicKey: string, signal: AbortSignal) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
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
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.disposeIdentityKey.mockImplementationOnce(() => {
      throw new Error("cleanup details");
    });

    expectResultOk(await createSubject().establishIdentity(CREDENTIALS, () => undefined));
  });

  it("verifies Google Drive files before deleting them and removes the local identity last", async () => {
    const events: string[] = [];
    foundPassportFile();
    record(MOCKS.deleteVisibleRecoveryCopies, "visible-delete", events);
    record(MOCKS.deletePassportFile, "app-data-delete", events);
    vi.spyOn(LocalStorageIdentityRepository.prototype, "remove").mockImplementation(() => {
      events.push("local-remove");
      return Result.ok();
    });

    const result = await createSubject().detachIdentity(
      CREDENTIALS,
      PUBLIC_IDENTITY,
      CREDENTIALS.googleAccount.googleSubject,
    );

    expect(expectResultOk(result)).toBeUndefined();
    expect(events).toEqual(["visible-delete", "app-data-delete", "local-remove"]);
    expect(MOCKS.driveStoreConstructions.count).toBe(1);
    expect(MOCKS.visibleCopiesConstructions.count).toBe(1);
    expect(MOCKS.deletePassportFile).toHaveBeenCalledWith(REFERENCE);
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
  });

  it("deletes visible copies and the local identity when app-data is already missing", async () => {
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    const remove = vi.spyOn(LocalStorageIdentityRepository.prototype, "remove").mockReturnValue(Result.ok());

    expect(expectResultOk(await createSubject().detachIdentity(
      CREDENTIALS,
      PUBLIC_IDENTITY,
      CREDENTIALS.googleAccount.googleSubject,
    ))).toBeUndefined();
    expect(MOCKS.deleteVisibleRecoveryCopies).toHaveBeenCalledOnce();
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(PUBLIC_IDENTITY.publicKeyZ32);
  });

  it("keeps app-data and the local identity when visible-copy deletion fails", async () => {
    const diagnosticCanary = { secret: "DRIVE-CLEANUP-CAUSE-CANARY" };
    const lowerFailure = { code: "delete_failed", cause: diagnosticCanary };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    foundPassportFile();
    MOCKS.deleteVisibleRecoveryCopies.mockResolvedValue(Result.err(lowerFailure));
    const remove = vi.spyOn(LocalStorageIdentityRepository.prototype, "remove");

    const failure = expectResultError(await createSubject().detachIdentity(
      CREDENTIALS,
      PUBLIC_IDENTITY,
      CREDENTIALS.googleAccount.googleSubject,
    ), { code: "google_drive_cleanup_failed" });
    expect(failure.cause).toBe(lowerFailure);
    expect(JSON.stringify(warning.mock.calls)).not.toContain("DRIVE-CLEANUP-CAUSE-CANARY");
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not access Drive when detachment authorizes a different Google account", async () => {
    const remove = vi.spyOn(LocalStorageIdentityRepository.prototype, "remove");

    expectResultError(await createSubject().detachIdentity(
      CREDENTIALS,
      PUBLIC_IDENTITY,
      "different-google-account",
    ), { code: "google_drive_cleanup_failed" });
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
    vi.stubGlobal("fetch", vi.fn(async (_request, init) => {
      requestSignal = init?.signal;
      return new Response("{}", { status: 200 });
    }));
    const subject = createSubject();
    const fetchWithDeadline = MOCKS.GoogleWrappingKeyApiClient.mock.calls[0]?.[0] as typeof fetch;

    await fetchWithDeadline("/test");
    expect(requestSignal?.aborted).toBe(false);

    subject.abortRequests();
    expect(requestSignal?.aborted).toBe(true);
  });
});

function createSubject(): GoogleIdentityOperations {
  return new GoogleIdentityOperations(
    "https://homegate.example/",
    "https://passport.pubky.app",
  );
}

function foundPassportFile(): void {
  MOCKS.readPassportFile.mockResolvedValue(Result.ok({
    status: "found",
    envelope: ENVELOPE,
    reference: REFERENCE,
  }));
}

function record(mock: ReturnType<typeof vi.fn>, event: string, events: string[]): void {
  const implementation = mock.getMockImplementation() as ((...args: unknown[]) => unknown) | undefined;
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
    expect((result.error as Failure & { detailCode?: string }).detailCode)
      .toBe(expected.detailCode);
  }
  return result.error;
}
