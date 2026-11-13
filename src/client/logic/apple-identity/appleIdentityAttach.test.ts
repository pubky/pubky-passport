/** @vitest-environment jsdom */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { expectResultOk } from "@test-utils/resultAssertions";
import { LOGGER } from "@/libs/logger/logger";
import { AppleIdentityLifecycle, type ICloudStorePort } from "./AppleIdentityLifecycle";

const PUBKY = "attached-pubky";
const KEY = { keyHandle: { key: "this" }, publicIdentity: { publicKeyZ32: PUBKY } };
const OTHER_KEY = { keyHandle: { key: "other" }, publicIdentity: { publicKeyZ32: "other" } };
const ENVELOPE = {
  v: 1 as const,
  keyId: "current",
  iv: "a".repeat(16),
  ct: "b".repeat(64),
  url: "https://passport.pubky.app",
};
const REFERENCE = { recordName: "pubky-passport-file-v1", recordChangeTag: "tag-1" };
const CREDENTIALS = {
  appleIdToken: "apple-id-token",
  appleSubject: "001234.apple.subject",
  email: "jane@example.com",
  name: null,
  expiresAt: Date.now() + 600_000,
};

const MOCKS = {
  restoreIdentityKey: vi.fn(),
  exportSecretKey: vi.fn(),
  disposeIdentityKey: vi.fn(),
  requestWrappingKey: vi.fn(),
  requestAppleSignupToken: vi.fn(),
  encryptSecretKeyBytes: vi.fn(),
  decryptSecretKeyBytes: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  linkProviderAccount: vi.fn(),
  readPassportFile: vi.fn(),
  createPassportFile: vi.fn(),
  deletePassportFile: vi.fn(),
  deleteInvalidPassportFile: vi.fn(),
  signup: vi.fn(),
};
const STORE: ICloudStorePort = {
  readPassportFile: MOCKS.readPassportFile,
  createPassportFile: MOCKS.createPassportFile,
  deletePassportFile: MOCKS.deletePassportFile,
  deleteInvalidPassportFile: MOCKS.deleteInvalidPassportFile,
};

describe("Apple attach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.list.mockReturnValue(
      Result.ok({
        activePublicKeyZ32: PUBKY,
        identities: [{ publicIdentity: { publicKeyZ32: PUBKY } }],
      }),
    );
    MOCKS.read.mockImplementation(() =>
      Result.ok({
        identity: { publicIdentity: { publicKeyZ32: PUBKY } },
        secretKey: { bytes: new Uint8Array(32).fill(5), format: "pubky-secret-key" },
      }),
    );
    MOCKS.restoreIdentityKey.mockResolvedValue(Result.ok(KEY));
    MOCKS.exportSecretKey.mockImplementation(async () =>
      Result.ok({ bytes: new Uint8Array(32).fill(6), format: "pubky-secret-key" }),
    );
    MOCKS.requestWrappingKey.mockResolvedValue(
      Result.ok({ wrappingKey: "w".repeat(43), keyId: "current" }),
    );
    MOCKS.encryptSecretKeyBytes.mockResolvedValue(Result.ok(ENVELOPE));
    MOCKS.decryptSecretKeyBytes.mockResolvedValue(Result.ok(new Uint8Array(32).fill(9)));
    MOCKS.readPassportFile.mockResolvedValue(Result.ok({ status: "missing" }));
    MOCKS.createPassportFile.mockResolvedValue(Result.ok());
    MOCKS.linkProviderAccount.mockReturnValue(Result.ok("linked"));
  });

  it("stores a new iCloud record and links the Apple Account, with no Homegate signup", async () => {
    const result = await createSubject().attachIdentity(CREDENTIALS, STORE, {
      publicKeyZ32: PUBKY,
    });

    const appleAccount = {
      appleSubject: CREDENTIALS.appleSubject,
      email: "jane@example.com",
      name: null,
    };
    expect(expectResultOk(result)).toEqual({ attachment: "created", appleAccount });
    expect(MOCKS.requestWrappingKey).toHaveBeenCalledWith("apple-id-token", undefined);
    expect(MOCKS.encryptSecretKeyBytes.mock.calls[0]?.[4]).toEqual({ attached: true });
    expect(MOCKS.createPassportFile).toHaveBeenCalledExactlyOnceWith(ENVELOPE);
    expect(MOCKS.linkProviderAccount).toHaveBeenCalledWith(PUBKY, { appleAccount });
    expect(MOCKS.requestAppleSignupToken).not.toHaveBeenCalled();
    expect(MOCKS.signup).not.toHaveBeenCalled();
  });

  it("only links when the record already holds this pubky", async () => {
    MOCKS.readPassportFile.mockResolvedValue(
      Result.ok({ status: "found", envelope: ENVELOPE, reference: REFERENCE }),
    );

    const result = await createSubject().attachIdentity(CREDENTIALS, STORE, {
      publicKeyZ32: PUBKY,
    });

    expect(expectResultOk(result).attachment).toBe("linked");
    expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
  });

  it("refuses a record holding another pubky and changes nothing", async () => {
    MOCKS.readPassportFile.mockResolvedValue(
      Result.ok({ status: "found", envelope: ENVELOPE, reference: REFERENCE }),
    );
    MOCKS.restoreIdentityKey.mockResolvedValue(Result.ok(OTHER_KEY));

    const result = await createSubject().attachIdentity(CREDENTIALS, STORE, {
      publicKeyZ32: PUBKY,
    });

    expect(Result.isError(result) && result.error.code).toBe("provider_account_in_use");
    expect(MOCKS.createPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
    expect(MOCKS.deleteInvalidPassportFile).not.toHaveBeenCalled();
    expect(MOCKS.linkProviderAccount).not.toHaveBeenCalled();
  });

  it("maps iCloud failures: another Apple Account's record, conflict twice, quota", async () => {
    MOCKS.readPassportFile.mockResolvedValueOnce(Result.err({ code: "account_mismatch" }));
    let result = await createSubject().attachIdentity(CREDENTIALS, STORE, { publicKeyZ32: PUBKY });
    expect(Result.isError(result) && result.error.code).toBe("icloud_account_mismatch");

    MOCKS.createPassportFile.mockResolvedValue(Result.err({ code: "create_conflict" }));
    result = await createSubject().attachIdentity(CREDENTIALS, STORE, { publicKeyZ32: PUBKY });
    expect(Result.isError(result) && result.error.code).toBe("icloud_create_conflict");
    expect(MOCKS.createPassportFile).toHaveBeenCalledOnce();

    MOCKS.createPassportFile.mockResolvedValue(Result.err({ code: "quota_exceeded" }));
    result = await createSubject().attachIdentity(CREDENTIALS, STORE, { publicKeyZ32: PUBKY });
    expect(Result.isError(result) && result.error.code).toBe("icloud_quota_exceeded");
    expect(MOCKS.deletePassportFile).not.toHaveBeenCalled();
  });

  it("settles an unexpected exception as a Result", async () => {
    MOCKS.readPassportFile.mockRejectedValue(new Error("boom"));
    const result = await createSubject().attachIdentity(CREDENTIALS, STORE, {
      publicKeyZ32: PUBKY,
    });
    expect(Result.isError(result) && result.error.code).toBe("unexpected_failure");
  });
});

function createSubject(): AppleIdentityLifecycle {
  return new AppleIdentityLifecycle("https://homegate.example/", "https://passport.pubky.app", {
    pubky: {
      createIdentityKey: vi.fn(),
      exportSecretKey: MOCKS.exportSecretKey,
      restoreIdentityKey: MOCKS.restoreIdentityKey,
      signup: MOCKS.signup,
      signin: vi.fn(),
      resolveHomeserver: vi.fn(),
      publishHomeserver: vi.fn(),
      disposeIdentityKey: MOCKS.disposeIdentityKey,
      dispose: vi.fn(),
    },
    crypto: {
      encryptSecretKeyBytes: MOCKS.encryptSecretKeyBytes,
      decryptSecretKeyBytes: MOCKS.decryptSecretKeyBytes,
    },
    repository: { save: vi.fn(), remove: vi.fn() },
    identities: {
      list: MOCKS.list,
      read: MOCKS.read,
      linkProviderAccount: MOCKS.linkProviderAccount,
    },
    localIdentities: { list: MOCKS.list },
    wrappingKeys: { requestWrappingKey: MOCKS.requestWrappingKey },
    homegate: { requestAppleSignupToken: MOCKS.requestAppleSignupToken },
  });
}
