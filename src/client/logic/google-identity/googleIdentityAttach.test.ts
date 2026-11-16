/** @vitest-environment jsdom */

import { Result, type Result as ResultType } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { expectResultOk } from "@test-utils/resultAssertions";
import { encodeBase64Url } from "@/libs/encoding/base64Url";
import { LOGGER } from "@/libs/logger/logger";
import { PassportFileWebCrypto } from "@/client/logic/passport-file/PassportFileWebCrypto";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { GoogleIdentityLifecycle } from "./GoogleIdentityLifecycle";

const PUBKY = "attached-pubky";
const OTHER_PUBKY = "other-pubky";
const KEY = { keyHandle: { key: "this" }, publicIdentity: { publicKeyZ32: PUBKY } };
const OTHER_KEY = { keyHandle: { key: "other" }, publicIdentity: { publicKeyZ32: OTHER_PUBKY } };
const ENVELOPE = {
  v: 1 as const,
  keyId: "current",
  iv: "a".repeat(16),
  ct: "b".repeat(64),
  url: "https://passport.pubky.app",
};
const REFERENCE = { storageId: "file-id", revision: "1" };
const GOOGLE_ACCOUNT = {
  googleSubject: "google-subject",
  email: "user@example.com",
  name: "User",
  pictureUrl: null,
};
const CREDENTIALS = {
  googleIdToken: "google-id-token",
  driveAccessToken: "drive-access-token",
  driveAccessTokenExpiresAt: Date.now() + 3_600_000,
  visibleBackupPermissionGranted: true,
  googleAccount: GOOGLE_ACCOUNT,
};

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
  encryptSecretKeyBytes: vi.fn(),
  decryptSecretKeyBytes: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  linkProviderAccount: vi.fn(),
  readPassportFile: vi.fn(),
  createPassportFile: vi.fn(),
  deletePassportFile: vi.fn(),
  deleteInvalidPassportFile: vi.fn(),
  createVisibleRecoveryCopy: vi.fn(),
  deleteVisibleRecoveryCopies: vi.fn(),
};

let localSecret: Uint8Array;
let exportedSecret: Uint8Array;

function catalog(identities: LocalIdentityMetadata[]) {
  return Result.ok({ activePublicKeyZ32: PUBKY, identities });
}

describe("Google attach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    localSecret = new Uint8Array(32).fill(5);
    exportedSecret = new Uint8Array(32).fill(6);
    MOCKS.list.mockReturnValue(catalog([{ publicIdentity: { publicKeyZ32: PUBKY } }]));
    MOCKS.read.mockImplementation(() =>
      Result.ok({
        identity: { publicIdentity: { publicKeyZ32: PUBKY } },
        secretKey: { bytes: localSecret, format: "pubky-secret-key" },
      }),
    );
    MOCKS.restoreIdentityKey.mockImplementation(async (secretKey: { bytes: Uint8Array }) => {
      secretKey.bytes.fill(0);
      return Result.ok(KEY);
    });
    MOCKS.exportSecretKey.mockImplementation(async () =>
      Result.ok({ bytes: exportedSecret, format: "pubky-secret-key" }),
    );
    MOCKS.requestWrappingKey.mockResolvedValue(
      Result.ok({ wrappingKey: "w".repeat(43), keyId: "current" }),
    );
    MOCKS.encryptSecretKeyBytes.mockResolvedValue(Result.ok(ENVELOPE));
    MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.ok(new Uint8Array(32).fill(9)));
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.createPassportFile.mockResolvedValue(Result.ok());
    MOCKS.createVisibleRecoveryCopy.mockResolvedValue(Result.ok());
    MOCKS.linkProviderAccount.mockReturnValue(Result.ok("linked"));
  });

  it("stores this browser's key in a new Drive file and links the account, without a homeserver", async () => {
    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expect(expectResultOk(result)).toEqual({
      attachment: "created",
      visibleRecoveryCopyStatus: "created",
    });
    expect(MOCKS.requestWrappingKey).toHaveBeenCalledWith("google-id-token", undefined);
    expect(MOCKS.read).toHaveBeenCalledWith(PUBKY);
    // Marked as attached, so a later restore never signs this pubky up on Passport's homeserver.
    expect(MOCKS.encryptSecretKeyBytes).toHaveBeenCalledWith(
      exportedSecret,
      "w".repeat(43),
      "https://passport.pubky.app",
      "current",
      { attached: true },
    );
    expect(MOCKS.createPassportFile).toHaveBeenCalledExactlyOnceWith(ENVELOPE);
    expect(MOCKS.createVisibleRecoveryCopy).toHaveBeenCalledWith(
      ENVELOPE,
      { publicKeyZ32: PUBKY },
      expect.any(AbortSignal),
    );
    expect(MOCKS.linkProviderAccount).toHaveBeenCalledExactlyOnceWith(PUBKY, {
      googleAccount: GOOGLE_ACCOUNT,
    });
    // Key bytes are cleared and the SDK key is released.
    expect(localSecret.every((byte) => byte === 0)).toBe(true);
    expect(exportedSecret.every((byte) => byte === 0)).toBe(true);
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY.keyHandle);
    // No new identity, no signup, no homeserver change, no full local save, nothing deleted.
    expect(MOCKS.createIdentityKey).not.toHaveBeenCalled();
    expect(MOCKS.requestSignupToken).not.toHaveBeenCalled();
    expect(MOCKS.signup).not.toHaveBeenCalled();
    expect(MOCKS.signin).not.toHaveBeenCalled();
    expect(MOCKS.publishHomeserver).not.toHaveBeenCalled();
    expect(MOCKS.save).not.toHaveBeenCalled();
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(MOCKS.deleteInvalidPassportFile).not.toHaveBeenCalled();
  });

  it("writes a file marked attached, which a later restore never signs up", async () => {
    const crypto = new PassportFileWebCrypto();
    MOCKS.requestWrappingKey.mockResolvedValue(
      Result.ok({ wrappingKey: encodeBase64Url(new Uint8Array(32).fill(3)), keyId: "current" }),
    );
    MOCKS.encryptSecretKeyBytes.mockImplementation(
      (...args: Parameters<PassportFileWebCrypto["encryptSecretKeyBytes"]>) =>
        crypto.encryptSecretKeyBytes(...args),
    );
    MOCKS.decryptSecretKeyBytes.mockImplementation(
      (...args: Parameters<PassportFileWebCrypto["decryptSecretKeyBytes"]>) =>
        crypto.decryptSecretKeyBytes(...args),
    );

    const attached = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });
    expect(expectResultOk(attached).attachment).toBe("created");
    const written = MOCKS.createPassportFile.mock.calls[0]?.[0];
    expect(written).toMatchObject({ v: 1, keyId: "current", attached: true });

    // Another device: Drive holds that file, sign-in fails and the record cannot be found.
    MOCKS.readPassportFile.mockResolvedValue(
      Result.ok({ status: "found", envelope: written, reference: REFERENCE }),
    );
    MOCKS.signin.mockResolvedValue(Result.err({ code: "signin_failed" }));
    MOCKS.resolveHomeserver.mockResolvedValue(Result.ok(null));
    const restored = await createSubject().establishIdentity(CREDENTIALS, () => undefined);

    expectError(restored, "homeserver_not_found");
    expect(MOCKS.decryptSecretKeyBytes).toHaveBeenCalledOnce();
    expect(MOCKS.requestSignupToken).not.toHaveBeenCalled();
    expect(MOCKS.signup).not.toHaveBeenCalled();
    expect(MOCKS.publishHomeserver).not.toHaveBeenCalled();
    expect(MOCKS.save).not.toHaveBeenCalled();
  });

  it("skips the visible copy without that permission", async () => {
    const result = await createSubject().attachIdentity(
      { ...CREDENTIALS, visibleBackupPermissionGranted: false },
      { publicKeyZ32: PUBKY },
    );

    expect(expectResultOk(result)).toEqual({
      attachment: "created",
      visibleRecoveryCopyStatus: "skipped",
    });
    expect(MOCKS.createVisibleRecoveryCopy).not.toHaveBeenCalled();
  });

  it("only links when Drive already holds this pubky", async () => {
    foundFile();
    MOCKS.restoreIdentityKey.mockResolvedValue(Result.ok(KEY));

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expect(expectResultOk(result)).toEqual({
      attachment: "linked",
      visibleRecoveryCopyStatus: "skipped",
    });
    expect(MOCKS.requestWrappingKey).toHaveBeenCalledWith("google-id-token", "current");
    expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.createVisibleRecoveryCopy).not.toHaveBeenCalled();
    expect(MOCKS.read).not.toHaveBeenCalled();
    expect(MOCKS.linkProviderAccount).toHaveBeenCalledOnce();
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY.keyHandle);
  });

  it("refuses an account whose Drive holds another pubky and writes or deletes nothing", async () => {
    foundFile();
    MOCKS.restoreIdentityKey.mockResolvedValue(Result.ok(OTHER_KEY));

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expectError(result, "provider_account_in_use");
    expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(MOCKS.deleteInvalidPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.createVisibleRecoveryCopy).not.toHaveBeenCalled();
    expect(MOCKS.deleteVisibleRecoveryCopies).not.toHaveBeenCalled();
    expect(MOCKS.linkProviderAccount).not.toHaveBeenCalled();
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(OTHER_KEY.keyHandle);
  });

  it("refuses before any Drive request when another local identity uses this account", async () => {
    MOCKS.list.mockReturnValue(
      catalog([
        { publicIdentity: { publicKeyZ32: PUBKY } },
        { publicIdentity: { publicKeyZ32: OTHER_PUBKY }, googleAccount: GOOGLE_ACCOUNT },
      ]),
    );

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expectError(result, "provider_account_in_use");
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.requestWrappingKey).not.toHaveBeenCalled();
  });

  it("stops when the identity got another account meanwhile", async () => {
    MOCKS.list.mockReturnValue(
      catalog([
        {
          publicIdentity: { publicKeyZ32: PUBKY },
          googleAccount: { ...GOOGLE_ACCOUNT, googleSubject: "someone-else" },
        },
      ]),
    );

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expectError(result, "identity_already_linked");
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
  });

  it("stops when the identity is no longer in this browser", async () => {
    MOCKS.list.mockReturnValue(catalog([]));

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expectError(result, "local_identity_unavailable");
    expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
  });

  it("reports our own upload as created when the read after create_conflict finds it", async () => {
    const written = { ...ENVELOPE, attached: true as const };
    MOCKS.encryptSecretKeyBytes.mockResolvedValue(Result.ok(written));
    MOCKS.readPassportFile
      .mockResolvedValueOnce(Result.ok({ status: "missing" }))
      .mockResolvedValueOnce(
        // Read back from Drive: equal, but a separate parsed object.
        Result.ok({ status: "found", envelope: { ...written }, reference: REFERENCE }),
      );
    MOCKS.createPassportFile.mockResolvedValue(Result.err({ code: "create_conflict" }));

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expect(expectResultOk(result)).toEqual({
      attachment: "created",
      visibleRecoveryCopyStatus: "created",
    });
    expect(MOCKS.createPassportFile).toHaveBeenCalledOnce();
    expect(MOCKS.createVisibleRecoveryCopy).toHaveBeenCalledExactlyOnceWith(
      written,
      { publicKeyZ32: PUBKY },
      expect.any(AbortSignal),
    );
    expect(MOCKS.linkProviderAccount).toHaveBeenCalledOnce();
  });

  it("reads again after create_conflict and links a file that holds this pubky", async () => {
    // Another tab's file: same pubky, but its own IV and ciphertext.
    const otherUpload = { ...ENVELOPE, iv: "c".repeat(16), ct: "d".repeat(64) };
    MOCKS.readPassportFile
      .mockResolvedValueOnce(Result.ok({ status: "missing" }))
      .mockResolvedValueOnce(
        Result.ok({ status: "found", envelope: otherUpload, reference: REFERENCE }),
      );
    MOCKS.createPassportFile.mockResolvedValue(Result.err({ code: "create_conflict" }));

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expect(expectResultOk(result).attachment).toBe("linked");
    expect(MOCKS.readPassportFile).toHaveBeenCalledTimes(2);
    expect(MOCKS.createPassportFile).toHaveBeenCalledOnce();
    expect(MOCKS.createVisibleRecoveryCopy).not.toHaveBeenCalled();
  });

  it("refuses after create_conflict when the new file holds another pubky", async () => {
    MOCKS.readPassportFile
      .mockResolvedValueOnce(Result.ok({ status: "missing" }))
      .mockResolvedValueOnce(
        Result.ok({ status: "found", envelope: ENVELOPE, reference: REFERENCE }),
      );
    MOCKS.createPassportFile.mockResolvedValue(Result.err({ code: "create_conflict" }));
    MOCKS.restoreIdentityKey
      .mockImplementationOnce(async (secretKey: { bytes: Uint8Array }) => {
        secretKey.bytes.fill(0);
        return Result.ok(KEY);
      })
      .mockResolvedValueOnce(Result.ok(OTHER_KEY));

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expectError(result, "provider_account_in_use");
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(MOCKS.linkProviderAccount).not.toHaveBeenCalled();
  });

  it("never writes a second file when the read after a conflict still finds none", async () => {
    MOCKS.createPassportFile.mockResolvedValue(Result.err({ code: "create_conflict" }));

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expectError(result, "drive_create_conflict");
    expect(MOCKS.readPassportFile).toHaveBeenCalledTimes(2);
    expect(MOCKS.createPassportFile).toHaveBeenCalledOnce();
    expect(MOCKS.linkProviderAccount).not.toHaveBeenCalled();
  });

  it("reports the conflict when reading again fails, since our file may be stored", async () => {
    MOCKS.readPassportFile
      .mockResolvedValueOnce(Result.ok({ status: "missing" }))
      .mockResolvedValueOnce(Result.err({ code: "duplicate_files" }));
    MOCKS.createPassportFile.mockResolvedValue(Result.err({ code: "create_conflict" }));
    expectError(
      await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY }),
      "drive_create_conflict",
    );

    MOCKS.readPassportFile
      .mockResolvedValueOnce(Result.ok({ status: "missing" }))
      .mockResolvedValueOnce(
        Result.ok({ status: "found", envelope: ENVELOPE, reference: REFERENCE }),
      );
    MOCKS.decryptSecretKeyBytes.mockResolvedValueOnce(Result.err({ code: "decrypt_failed" }));
    expectError(
      await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY }),
      "drive_create_conflict",
    );
    expect(MOCKS.createPassportFile).toHaveBeenCalledTimes(2);
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
  });

  it("reports an unconfirmed visible copy without failing the attach", async () => {
    MOCKS.createVisibleRecoveryCopy.mockResolvedValue(Result.err({ code: "forbidden" }));

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expect(expectResultOk(result)).toEqual({
      attachment: "created",
      visibleRecoveryCopyStatus: "unconfirmed",
    });
    expect(MOCKS.linkProviderAccount).toHaveBeenCalledOnce();
  });

  it("runs under a per-pubky Web Lock when the browser has one", async () => {
    const names: string[] = [];
    vi.stubGlobal("navigator", {
      locks: {
        request: async (name: string, callback: () => Promise<unknown>) => {
          names.push(name);
          return callback();
        },
      },
    });
    try {
      const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });
      expect(expectResultOk(result).attachment).toBe("created");
      expect(names).toEqual([`pubky-passport:attach:${PUBKY}`]);

      vi.stubGlobal("navigator", {
        locks: { request: async () => Promise.reject(new Error("lock unavailable")) },
      });
      expectError(
        await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY }),
        "unexpected_failure",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stops on a damaged Drive file and offers no replacement", async () => {
    MOCKS.readPassportFile.mockResolvedValue(Result.err({ code: "invalid_file" }));

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expectError(result, "invalid_passport_file");
    expect(MOCKS.deleteInvalidPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
  });

  it("stops on a Drive file this account cannot decrypt", async () => {
    foundFile();
    MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.err({ code: "decrypt_failed" }));

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expectError(result, "decrypt_failed");
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
  });

  it("never uploads a stored key that does not derive this pubky", async () => {
    MOCKS.restoreIdentityKey.mockImplementation(async (secretKey: { bytes: Uint8Array }) => {
      secretKey.bytes.fill(0);
      return Result.ok(OTHER_KEY);
    });

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expectError(result, "identity_mismatch");
    expect(MOCKS.encryptSecretKeyBytes).not.toHaveBeenCalled();
    expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(OTHER_KEY.keyHandle);
  });

  it("reports a failed wrapping key before reading the local key", async () => {
    MOCKS.requestWrappingKey.mockResolvedValue(Result.err({ code: "unauthorized" }));

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expectError(result, "wrapping_key_failed");
    expect(MOCKS.read).not.toHaveBeenCalled();
    expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
  });

  it("keeps the Drive file and reports a failed local link, so trying again links it", async () => {
    MOCKS.linkProviderAccount.mockReturnValue(Result.err({ code: "storage_unavailable" }));

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expectError(result, "local_link_failed");
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    // No visible copy for an attach that did not finish.
    expect(MOCKS.createVisibleRecoveryCopy).not.toHaveBeenCalled();
  });

  it.each(["provider_conflict", "provider_in_use"])(
    "reports %s at link time as identity_linked_meanwhile",
    async (code) => {
      MOCKS.linkProviderAccount.mockReturnValue(Result.err({ code }));

      const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

      expectError(result, "identity_linked_meanwhile");
    },
  );

  it("reports a stored key that cannot be read before any write", async () => {
    MOCKS.read.mockReturnValue(Result.err({ code: "invalid_store" }));

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expectError(result, "local_identity_unavailable");
    expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
  });

  it("maps Drive read and write failures", async () => {
    MOCKS.readPassportFile.mockResolvedValueOnce(Result.err({ code: "network_failed" }));
    expectError(
      await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY }),
      "drive_read_failed",
    );

    MOCKS.createPassportFile.mockResolvedValueOnce(Result.err({ code: "write_failed" }));
    expectError(
      await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY }),
      "drive_write_failed",
    );
  });

  it("settles an unexpected exception as a Result", async () => {
    MOCKS.readPassportFile.mockRejectedValue(new Error("boom"));

    const result = await createSubject().attachIdentity(CREDENTIALS, { publicKeyZ32: PUBKY });

    expectError(result, "unexpected_failure");
  });
});

function createSubject(): GoogleIdentityLifecycle {
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
    repository: { save: MOCKS.save, remove: MOCKS.remove },
    identities: {
      list: MOCKS.list,
      read: MOCKS.read,
      linkProviderAccount: MOCKS.linkProviderAccount,
    },
    wrappingKeys: { requestWrappingKey: MOCKS.requestWrappingKey },
    homegate: { requestGoogleSignupToken: MOCKS.requestSignupToken },
    createDriveStore: () => ({
      createPassportFile: MOCKS.createPassportFile,
      deleteInvalidPassportFile: MOCKS.deleteInvalidPassportFile,
      deletePassportFile: MOCKS.deletePassportFile,
      readPassportFile: MOCKS.readPassportFile,
    }),
    createVisibleRecoveryCopies: () => ({
      createVisibleRecoveryCopy: MOCKS.createVisibleRecoveryCopy,
      deleteVisibleRecoveryCopies: MOCKS.deleteVisibleRecoveryCopies,
    }),
  });
}

function foundFile(): void {
  MOCKS.readPassportFile.mockResolvedValue(
    Result.ok({ status: "found", envelope: ENVELOPE, reference: REFERENCE }),
  );
}

function expectError<Success, Failure extends { code: string }>(
  result: ResultType<Success, Failure>,
  code: string,
): void {
  expect(Result.isError(result)).toBe(true);
  if (Result.isError(result)) expect(result.error.code).toBe(code);
}
