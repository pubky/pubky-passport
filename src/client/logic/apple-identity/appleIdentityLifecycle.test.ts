/** @vitest-environment jsdom */

import { Result, type Result as ResultType } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";
import { LOGGER } from "@/libs/logger/logger";
import type { IdentityProgress } from "@/client/logic/identity-lifecycle/PassportFileIdentityLifecycle";
import { AppleIdentityLifecycle, type ICloudStorePort } from "./AppleIdentityLifecycle";

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
  requestAppleSignupToken: vi.fn(),
  encryptSecretKeyBytes: vi.fn(),
  decryptSecretKeyBytes: vi.fn(),
  repositorySave: vi.fn(),
  repositoryRemove: vi.fn(),
  repositoryList: vi.fn(),
  readPassportFile: vi.fn(),
  deleteInvalidPassportFile: vi.fn(),
  createPassportFile: vi.fn(),
  deletePassportFile: vi.fn(),
};

const PUBLIC_IDENTITY = { publicKeyZ32: "public-identity" };
const KEY_HANDLE = {};
const IDENTITY = { keyHandle: KEY_HANDLE, publicIdentity: PUBLIC_IDENTITY };
const ENVELOPE = {
  v: 1 as const,
  keyId: "retained",
  iv: "a".repeat(16),
  ct: "b".repeat(64),
  url: "https://passport.pubky.app",
};
const REFERENCE = { recordName: "pubky-passport-file-v1", recordChangeTag: "tag-1" };
const CREDENTIALS = {
  appleIdToken: "apple-id-token",
  appleSubject: "001234.apple.subject",
  email: "jane@example.com",
  name: "Jane Appleseed",
  expiresAt: Date.now() + 600_000,
};
const APPLE_ACCOUNT = {
  appleSubject: "001234.apple.subject",
  email: "jane@example.com",
  name: "Jane Appleseed",
};
const SIGNUP_DETAILS = { homeserverPubky: "homeserver-pubky", signupToken: "signup-token" };
const STORE: ICloudStorePort = {
  readPassportFile: MOCKS.readPassportFile,
  createPassportFile: MOCKS.createPassportFile,
  deletePassportFile: MOCKS.deletePassportFile,
  deleteInvalidPassportFile: MOCKS.deleteInvalidPassportFile,
};

describe("Apple identity lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MOCKS.requestWrappingKey.mockResolvedValue(
      Result.ok({ wrappingKey: "w".repeat(43), keyId: "current" }),
    );
    MOCKS.requestAppleSignupToken.mockResolvedValue(Result.ok(SIGNUP_DETAILS));
    MOCKS.createIdentityKey.mockResolvedValue(Result.ok(IDENTITY));
    MOCKS.exportSecretKey.mockImplementation(async () =>
      Result.ok({ bytes: new Uint8Array(32).fill(7), format: "pubky-secret-key" }),
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
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.createPassportFile.mockResolvedValue(Result.ok());
    MOCKS.deletePassportFile.mockResolvedValue(Result.ok());
    MOCKS.deleteInvalidPassportFile.mockResolvedValue(Result.ok("deleted"));
    MOCKS.repositorySave.mockReturnValue(Result.ok({ publicIdentity: PUBLIC_IDENTITY }));
    MOCKS.repositoryRemove.mockReturnValue(Result.ok());
    MOCKS.repositoryList.mockReturnValue(Result.ok({ activePublicKeyZ32: null, identities: [] }));
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("establishIdentity", () => {
    it("restores a found file with its key ID and saves the Apple Account", async () => {
      foundPassportFile();

      const result = await createSubject().establishIdentity(CREDENTIALS, STORE, () => undefined);

      expect(expectResultOk(result)).toEqual({
        establishmentMode: "restored",
        appleAccount: APPLE_ACCOUNT,
        publicIdentity: PUBLIC_IDENTITY,
      });
      expect(MOCKS.requestWrappingKey).toHaveBeenCalledWith("apple-id-token", "retained");
      expect(MOCKS.decryptSecretKeyBytes).toHaveBeenCalledWith(
        ENVELOPE,
        "w".repeat(43),
        "https://passport.pubky.app",
      );
      expect(MOCKS.repositorySave).toHaveBeenCalledOnce();
      expect(MOCKS.repositorySave.mock.calls[0]?.[0]).toEqual({
        publicIdentity: PUBLIC_IDENTITY,
        appleAccount: APPLE_ACCOUNT,
      });
      expect(MOCKS.requestAppleSignupToken).not.toHaveBeenCalled();
      expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
    });

    it("keeps a name this browser already has when Apple sends none", async () => {
      foundPassportFile();
      MOCKS.repositoryList.mockReturnValue(
        Result.ok({
          activePublicKeyZ32: null,
          identities: [{ publicIdentity: { publicKeyZ32: "other" }, appleAccount: APPLE_ACCOUNT }],
        }),
      );

      const result = await createSubject().establishIdentity(
        { ...CREDENTIALS, name: null },
        STORE,
        () => undefined,
      );

      expect(expectResultOk(result).appleAccount).toEqual(APPLE_ACCOUNT);
      expect(MOCKS.repositorySave.mock.calls[0]?.[0]).toMatchObject({
        appleAccount: APPLE_ACCOUNT,
      });
    });

    it("never takes a name stored for another Apple subject", async () => {
      foundPassportFile();
      MOCKS.repositoryList.mockReturnValue(
        Result.ok({
          activePublicKeyZ32: null,
          identities: [
            {
              publicIdentity: { publicKeyZ32: "other" },
              appleAccount: { ...APPLE_ACCOUNT, appleSubject: "001234.someone.else" },
            },
          ],
        }),
      );

      const result = await createSubject().establishIdentity(
        { ...CREDENTIALS, name: null },
        STORE,
        () => undefined,
      );

      expect(expectResultOk(result).appleAccount.name).toBeNull();
    });

    it("saves the email alone when no name is known", async () => {
      foundPassportFile();

      const result = await createSubject().establishIdentity(
        { ...CREDENTIALS, name: null },
        STORE,
        () => undefined,
      );

      expect(expectResultOk(result).appleAccount).toEqual({ ...APPLE_ACCOUNT, name: null });
    });

    it("sends only the Apple ID token to Passport's server and Homegate", async () => {
      const result = await createSubject().establishIdentity(CREDENTIALS, STORE, () => undefined);

      expectResultOk(result);
      for (const call of [
        ...MOCKS.requestWrappingKey.mock.calls,
        ...MOCKS.requestAppleSignupToken.mock.calls,
      ]) {
        expect(JSON.stringify(call)).not.toContain("Jane");
        expect(JSON.stringify(call)).not.toContain("jane@example.com");
      }
      expect(MOCKS.requestWrappingKey).toHaveBeenCalledWith("apple-id-token", undefined);
      expect(MOCKS.requestAppleSignupToken).toHaveBeenCalledWith("apple-id-token");
    });

    it("creates a missing identity, storing the file in iCloud before signup", async () => {
      const events: string[] = [];
      record(MOCKS.requestAppleSignupToken, "homegate", events);
      record(MOCKS.createIdentityKey, "create-key", events);
      record(MOCKS.createPassportFile, "icloud-create", events);
      record(MOCKS.signup, "signup", events);
      record(MOCKS.signin, "signin", events);
      record(MOCKS.repositorySave, "save", events);
      const progress: IdentityProgress[] = [];

      const result = await createSubject().establishIdentity(CREDENTIALS, STORE, (phase) =>
        progress.push(phase),
      );

      expect(expectResultOk(result)).toEqual({
        establishmentMode: "created",
        appleAccount: APPLE_ACCOUNT,
        publicIdentity: PUBLIC_IDENTITY,
      });
      expect(MOCKS.requestWrappingKey).toHaveBeenCalledWith("apple-id-token", undefined);
      expect(MOCKS.requestAppleSignupToken).toHaveBeenCalledWith("apple-id-token");
      expect(MOCKS.encryptSecretKeyBytes).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "w".repeat(43),
        "https://passport.pubky.app",
        "current",
      );
      expect(MOCKS.createPassportFile).toHaveBeenCalledWith(ENVELOPE);
      expect(events.slice(0, 5)).toEqual([
        "homegate",
        "create-key",
        "icloud-create",
        "signup",
        "signin",
      ]);
      expect(events).toContain("save");
      expect(MOCKS.repositorySave.mock.calls[0]?.[0]).toEqual({
        publicIdentity: PUBLIC_IDENTITY,
        appleAccount: APPLE_ACCOUNT,
      });
      expect(progress[0]).toEqual({ flow: "lookup", step: "checking" });
      expect(progress).toContainEqual({ flow: "create", step: "storing_passport_file" });
    });

    it.each([
      [{ code: "invalid_file" }, { code: "invalid_passport_file" }],
      [{ code: "account_mismatch" }, { code: "icloud_account_mismatch" }],
      [{ code: "not_signed_in" }, { code: "icloud_read_failed", detailCode: "not_signed_in" }],
      [{ code: "network_failed" }, { code: "icloud_read_failed", detailCode: "network_failed" }],
    ])("maps the read failure %j", async (failure, expected) => {
      MOCKS.readPassportFile.mockResolvedValue(Result.err(failure));

      const result = await createSubject().establishIdentity(CREDENTIALS, STORE, () => undefined);

      expectError(result, expected);
      expect(MOCKS.requestWrappingKey).not.toHaveBeenCalled();
      expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
    });

    it.each([
      [{ code: "create_conflict" }, { code: "icloud_create_conflict" }],
      [{ code: "quota_exceeded" }, { code: "icloud_quota_exceeded" }],
      [{ code: "write_failed" }, { code: "icloud_write_failed", detailCode: "write_failed" }],
    ])("maps the create failure %j and does not sign up", async (failure, expected) => {
      MOCKS.createPassportFile.mockResolvedValue(Result.err(failure));

      const result = await createSubject().establishIdentity(CREDENTIALS, STORE, () => undefined);

      expectError(result, expected);
      expect(MOCKS.signup).not.toHaveBeenCalled();
      expect(MOCKS.repositorySave).not.toHaveBeenCalled();
    });

    it("reports a homegate failure without creating a key", async () => {
      MOCKS.requestAppleSignupToken.mockResolvedValue(
        Result.err({ code: "invalid_apple_id_token" }),
      );

      const result = await createSubject().establishIdentity(CREDENTIALS, STORE, () => undefined);

      expectError(result, {
        code: "homeserver_signup_token_failed",
        detailCode: "invalid_apple_id_token",
      });
      expect(MOCKS.createIdentityKey).not.toHaveBeenCalled();
    });

    it("never deletes an undecryptable file during a normal establishment", async () => {
      foundPassportFile();
      MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.err({ code: "decrypt_failed" }));

      const result = await createSubject().establishIdentity(CREDENTIALS, STORE, () => undefined);

      expectError(result, { code: "decrypt_failed" });
      expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    });
  });

  describe("replaceUndecryptablePassportFile", () => {
    it("deletes the read record version when decryption fails, then creates", async () => {
      foundPassportFile();
      MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.err({ code: "decrypt_failed" }));
      const events: string[] = [];
      record(MOCKS.deletePassportFile, "delete", events);
      record(MOCKS.createPassportFile, "create", events);

      const result = await createSubject().replaceUndecryptablePassportFile(
        CREDENTIALS,
        STORE,
        () => undefined,
      );

      expect(expectResultOk(result).establishmentMode).toBe("created");
      expect(MOCKS.deletePassportFile).toHaveBeenCalledWith(REFERENCE);
      expect(events).toEqual(["delete", "create"]);
    });

    it("restores and keeps a file that decrypts after all", async () => {
      foundPassportFile();

      const result = await createSubject().replaceUndecryptablePassportFile(
        CREDENTIALS,
        STORE,
        () => undefined,
      );

      expect(expectResultOk(result).establishmentMode).toBe("restored");
      expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    });

    it("stops when the delete fails", async () => {
      foundPassportFile();
      MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.err({ code: "decrypt_failed" }));
      MOCKS.deletePassportFile.mockResolvedValue(Result.err({ code: "stale_file" }));

      const result = await createSubject().replaceUndecryptablePassportFile(
        CREDENTIALS,
        STORE,
        () => undefined,
      );

      expectError(result, { code: "undecryptable_passport_file_delete_failed" });
      expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
    });
  });

  describe("replaceInvalidPassportFile", () => {
    it("deletes the invalid record before establishing", async () => {
      const events: string[] = [];
      record(MOCKS.deleteInvalidPassportFile, "delete-invalid", events);
      record(MOCKS.readPassportFile, "read", events);

      const result = await createSubject().replaceInvalidPassportFile(
        CREDENTIALS,
        STORE,
        () => undefined,
      );

      expect(expectResultOk(result).establishmentMode).toBe("created");
      expect(events.slice(0, 2)).toEqual(["delete-invalid", "read"]);
    });

    it("stops when the invalid record cannot be deleted", async () => {
      MOCKS.deleteInvalidPassportFile.mockResolvedValue(Result.err({ code: "stale_file" }));

      const result = await createSubject().replaceInvalidPassportFile(
        CREDENTIALS,
        STORE,
        () => undefined,
      );

      expectError(result, { code: "invalid_passport_file_delete_failed" });
      expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
    });
  });

  describe("detachIdentity", () => {
    it("refuses another Apple Account without touching iCloud", async () => {
      const result = await createSubject().detachIdentity(
        CREDENTIALS,
        STORE,
        PUBLIC_IDENTITY,
        "other-subject",
      );

      expectError(result, { code: "apple_account_mismatch" });
      expect(MOCKS.readPassportFile).not.toHaveBeenCalled();
      expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
      expect(MOCKS.repositoryRemove).not.toHaveBeenCalled();
    });

    it("decrypts and checks the identity before deleting the record, then removes it locally", async () => {
      foundPassportFile();
      const events: string[] = [];
      record(MOCKS.decryptSecretKeyBytes, "decrypt", events);
      record(MOCKS.restoreIdentityKey, "restore", events);
      record(MOCKS.deletePassportFile, "delete", events);
      MOCKS.repositoryRemove.mockImplementation(() => {
        events.push("remove");
        return Result.ok();
      });

      const result = await createSubject().detachIdentity(
        CREDENTIALS,
        STORE,
        PUBLIC_IDENTITY,
        CREDENTIALS.appleSubject,
      );

      expectResultOk(result);
      expect(MOCKS.requestWrappingKey).toHaveBeenCalledWith("apple-id-token", "retained");
      expect(MOCKS.deletePassportFile).toHaveBeenCalledWith(REFERENCE);
      expect(MOCKS.repositoryRemove).toHaveBeenCalledWith("public-identity");
      expect(events).toEqual(["decrypt", "restore", "delete", "remove"]);
      expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(KEY_HANDLE);
    });

    it("keeps the local identity when the connected iCloud has no record", async () => {
      const result = await createSubject().detachIdentity(
        CREDENTIALS,
        STORE,
        PUBLIC_IDENTITY,
        CREDENTIALS.appleSubject,
      );

      expectResultError(result, { code: "icloud_record_missing" });
      expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
      expect(MOCKS.repositoryRemove).not.toHaveBeenCalled();
    });

    it("keeps everything when the record holds another identity", async () => {
      foundPassportFile();
      MOCKS.restoreIdentityKey.mockResolvedValue(
        Result.ok({ keyHandle: KEY_HANDLE, publicIdentity: { publicKeyZ32: "other" } }),
      );

      const result = await createSubject().detachIdentity(
        CREDENTIALS,
        STORE,
        PUBLIC_IDENTITY,
        CREDENTIALS.appleSubject,
      );

      expectError(result, { code: "identity_mismatch" });
      expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
      expect(MOCKS.repositoryRemove).not.toHaveBeenCalled();
    });

    it.each([
      [
        "read",
        () => MOCKS.readPassportFile.mockResolvedValue(Result.err({ code: "not_signed_in" })),
      ],
      [
        "delete",
        () => {
          foundPassportFile();
          MOCKS.deletePassportFile.mockResolvedValue(Result.err({ code: "stale_file" }));
        },
      ],
    ])("keeps the local identity when the iCloud %s fails", async (_stage, arrange) => {
      arrange();

      const result = await createSubject().detachIdentity(
        CREDENTIALS,
        STORE,
        PUBLIC_IDENTITY,
        CREDENTIALS.appleSubject,
      );

      expectError(result, { code: "icloud_cleanup_failed" });
      expect(MOCKS.repositoryRemove).not.toHaveBeenCalled();
    });

    it("keeps the record when decryption fails", async () => {
      foundPassportFile();
      MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.err({ code: "decrypt_failed" }));

      const result = await createSubject().detachIdentity(
        CREDENTIALS,
        STORE,
        PUBLIC_IDENTITY,
        CREDENTIALS.appleSubject,
      );

      expectError(result, { code: "decrypt_failed" });
      expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
      expect(MOCKS.repositoryRemove).not.toHaveBeenCalled();
    });
  });
});

function createSubject(): AppleIdentityLifecycle {
  return new AppleIdentityLifecycle("https://homegate.example/", "https://passport.pubky.app", {
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
    repository: { save: MOCKS.repositorySave, remove: MOCKS.repositoryRemove },
    localIdentities: { list: MOCKS.repositoryList },
    wrappingKeys: { requestWrappingKey: MOCKS.requestWrappingKey },
    homegate: { requestAppleSignupToken: MOCKS.requestAppleSignupToken },
  });
}

function foundPassportFile(): void {
  MOCKS.readPassportFile.mockResolvedValue(
    Result.ok({ status: "found", envelope: ENVELOPE, reference: REFERENCE }),
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

function expectError<Success, Failure extends { code: string }>(
  result: ResultType<Success, Failure>,
  expected: { code: string; detailCode?: string },
): void {
  expect(Result.isError(result)).toBe(true);
  if (!Result.isError(result)) return;
  expect(result.error.code).toBe(expected.code);
  if (expected.detailCode !== undefined) {
    expect((result.error as Failure & { detailCode?: string }).detailCode).toBe(
      expected.detailCode,
    );
  }
}
