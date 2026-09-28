import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PubkyIdentityKeyHandle } from "@/client/logic/pubky/pubkyIdentityKey";
import { LOGGER } from "@/libs/logger/logger";
import { expectResultOk, expectResultError } from "@test-utils/resultAssertions";
import {
  BackupVerifier,
  MAXIMUM_BACKUP_BYTES,
  MAXIMUM_BACKUP_PASSWORD_LENGTH,
  MINIMUM_BACKUP_PASSWORD_LENGTH,
  isValidNewBackupPassword,
  validateBackupInput,
  verifyBackupFile,
} from "./BackupVerifier";

const MOCKS = vi.hoisted(() => ({
  restoreRecoveryFile: vi.fn(),
  disposeIdentityKey: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("@/client/logic/pubky/PubkySdkAdapter", () => ({
  PubkySdkAdapter: class {
    restoreRecoveryFile = MOCKS.restoreRecoveryFile;
    disposeIdentityKey = MOCKS.disposeIdentityKey;
    dispose = MOCKS.dispose;
  },
}));

const handle = {} as PubkyIdentityKeyHandle;

describe("backup password rules", () => {
  it("applies the creation minimum only to new backups", () => {
    expect(isValidNewBackupPassword("x".repeat(MINIMUM_BACKUP_PASSWORD_LENGTH - 1))).toBe(false);
    expect(isValidNewBackupPassword("x".repeat(MINIMUM_BACKUP_PASSWORD_LENGTH))).toBe(true);
    expect(isValidNewBackupPassword("x".repeat(MAXIMUM_BACKUP_PASSWORD_LENGTH + 1))).toBe(false);
    // Files made by other Pubky tools may use any non-empty passphrase.
    expect(validateBackupInput(new Uint8Array([1]), "pin")).toBeNull();
  });

  it.each([
    [new Uint8Array([1]), "", "invalid_password"],
    [new Uint8Array([1]), "x".repeat(MAXIMUM_BACKUP_PASSWORD_LENGTH + 1), "invalid_password"],
    [new Uint8Array(), "correct horse battery", "invalid_backup"],
    [new Uint8Array(MAXIMUM_BACKUP_BYTES + 1), "correct horse battery", "invalid_backup"],
  ] as const)("rejects unusable input before decryption: %#", (bytes, password, code) => {
    expect(validateBackupInput(bytes, password)).toBe(code);
  });
});

describe("BackupVerifier", () => {
  it.each(["expected", "another"])(
    "checks the restored identity and releases its key: %s",
    (publicKeyZ32) => {
      const keys = {
        restoreRecoveryFile: vi.fn(() =>
          Result.ok({ keyHandle: handle, publicIdentity: { publicKeyZ32 } }),
        ),
        disposeIdentityKey: vi.fn(),
      };
      const bytes = new Uint8Array([1, 2, 3]);
      const result = new BackupVerifier(keys).verify(bytes, "pin", "expected");
      if (publicKeyZ32 === "expected") expectResultOk(result);
      else expectResultError(result, { code: "backup_mismatch" });
      expect(keys.disposeIdentityKey).toHaveBeenCalledWith(handle);
      expect(bytes).toEqual(new Uint8Array(3));
    },
  );

  it("reports an over-long password as a password problem and clears the file", () => {
    const keys = { restoreRecoveryFile: vi.fn(), disposeIdentityKey: vi.fn() };
    const bytes = new Uint8Array([1]);
    expectResultError(
      new BackupVerifier(keys).verify(
        bytes,
        "x".repeat(MAXIMUM_BACKUP_PASSWORD_LENGTH + 1),
        "expected",
      ),
      { code: "invalid_password" },
    );
    expect(keys.restoreRecoveryFile).not.toHaveBeenCalled();
    expect(bytes[0]).toBe(0);
  });

  it("clears file bytes even if the SDK throws", () => {
    const keys = {
      restoreRecoveryFile: vi.fn(() => {
        throw new Error("failed");
      }),
      disposeIdentityKey: vi.fn(),
    };
    const bytes = new Uint8Array([1]);
    expect(() => new BackupVerifier(keys).verify(bytes, "correct horse", "expected")).toThrow();
    expect(bytes[0]).toBe(0);
  });
});

describe("verifyBackupFile", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("verifies with its own SDK adapter and always releases it", async () => {
    MOCKS.restoreRecoveryFile.mockReturnValueOnce(
      Result.ok({ keyHandle: handle, publicIdentity: { publicKeyZ32: "expected" } }),
    );
    const bytes = new Uint8Array([1, 2, 3]);
    expectResultOk(await verifyBackupFile(bytes, "correct horse battery", "expected"));
    expect(MOCKS.disposeIdentityKey).toHaveBeenCalledWith(handle);
    expect(MOCKS.dispose).toHaveBeenCalledOnce();
    expect(bytes).toEqual(new Uint8Array(3));
  });

  it("settles SDK exceptions as a result without logging their message", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const cause = new Error("sensitive SDK detail");
    MOCKS.restoreRecoveryFile.mockImplementationOnce(() => {
      throw cause;
    });
    MOCKS.dispose.mockImplementationOnce(() => {
      throw new Error("dispose failed");
    });
    const bytes = new Uint8Array([1]);
    expectResultError(await verifyBackupFile(bytes, "correct horse battery", "expected"), {
      code: "verification_failed",
      cause,
    });
    expect(bytes[0]).toBe(0);
    expect(warning).toHaveBeenCalledWith(
      "identity.backup.verify.failed",
      expect.objectContaining({ operation: "verify_backup_file" }),
    );
    expect(warning).toHaveBeenCalledWith(
      "identity.backup.cleanup.failed",
      expect.objectContaining({ operation: "pubky_dispose" }),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("sensitive SDK detail");
  });
});
