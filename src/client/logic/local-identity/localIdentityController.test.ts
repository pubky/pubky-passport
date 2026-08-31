import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectResultOk } from "../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../libs/logger/logger";
import { PUBKY_SECRET_KEY_FORMAT, type PubkySecretKeyMaterial } from "../pubky/pubkyIdentityKey";
import { LocalStorageIdentityRepository } from "./LocalStorageIdentityRepository";

const MOCKS = vi.hoisted(() => ({
  createRecoveryFile: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("../pubky/PubkySdkAdapter", async (importOriginal) => {
  const original = await importOriginal<typeof import("../pubky/PubkySdkAdapter")>();
  return {
    ...original,
    PubkySdkAdapter: class {
      static createPubkyRingMigration(secretKey: PubkySecretKeyMaterial, publicKeyZ32: string) {
        return original.PubkySdkAdapter.createPubkyRingMigration(secretKey, publicKeyZ32);
      }
      createRecoveryFile = MOCKS.createRecoveryFile;
      dispose = MOCKS.dispose;
    },
  };
});

import { LocalIdentityController } from "./LocalIdentityController";

const PUBLIC_KEY = "yqooxx9u3aemh8mo5wcqq16yufu6jitouq1o4za751dger1igghy";

beforeEach(() => {
  MOCKS.createRecoveryFile.mockReset();
  MOCKS.dispose.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("LocalIdentityController", () => {
  it("delegates catalog actions to its concrete repository", () => {
    const list = vi
      .spyOn(LocalStorageIdentityRepository.prototype, "list")
      .mockReturnValue(Result.ok({ activePublicKeyZ32: null, identities: [] }));
    const select = vi
      .spyOn(LocalStorageIdentityRepository.prototype, "select")
      .mockReturnValue(Result.ok());
    const remove = vi
      .spyOn(LocalStorageIdentityRepository.prototype, "remove")
      .mockReturnValue(Result.ok());
    const controller = new LocalIdentityController();

    expect(controller.listIdentities()).toEqual(
      Result.ok({ activePublicKeyZ32: null, identities: [] }),
    );
    expect(controller.selectIdentity(PUBLIC_KEY)).toEqual(Result.ok());
    expect(controller.removeIdentity(PUBLIC_KEY)).toEqual(Result.ok());
    expect(list).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(remove).toHaveBeenCalledWith(PUBLIC_KEY);
  });

  it("creates an owned Ring migration and clears the repository secret bytes", async () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => index);
    const read = mockStoredIdentity(bytes);
    const controller = new LocalIdentityController();

    const migration = expectResultOk(await controller.createPubkyRingMigration(PUBLIC_KEY));
    expect(migration.url).toBe(
      "pubkyring://000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    );
    expect(read).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(bytes).toEqual(new Uint8Array(32));

    migration.dispose();
    expect(migration.url).toBeNull();
  });

  it("rejects weak recovery passwords before reading storage or creating the SDK", async () => {
    const read = vi.spyOn(LocalStorageIdentityRepository.prototype, "read");
    const controller = new LocalIdentityController();

    const result = await controller.createRecoveryFile(PUBLIC_KEY, "short");
    expect(Result.isError(result) && result.error).toEqual({ code: "invalid_password" });
    expect(read).not.toHaveBeenCalled();
    expect(MOCKS.createRecoveryFile).not.toHaveBeenCalled();
  });

  it("creates a named recovery file and releases sensitive resources", async () => {
    const secretBytes = new Uint8Array(32).fill(7);
    const recoveryBytes = new Uint8Array(64).fill(9);
    const password = "sixsix";
    mockStoredIdentity(secretBytes);
    MOCKS.createRecoveryFile.mockReturnValue(Result.ok(recoveryBytes));

    const recoveryFile = expectResultOk(
      await new LocalIdentityController().createRecoveryFile(PUBLIC_KEY, password),
    );

    expect(recoveryFile).toEqual({ bytes: recoveryBytes, fileName: `pubky-${PUBLIC_KEY}.pkarr` });
    expect(MOCKS.createRecoveryFile).toHaveBeenCalledWith(
      expect.objectContaining({ bytes: secretBytes }),
      PUBLIC_KEY,
      password,
    );
    expect(secretBytes).toEqual(new Uint8Array(32));
    expect(MOCKS.dispose).toHaveBeenCalledOnce();
  });

  it.each(["failure", "exception"] as const)(
    "contains an SDK %s and still clears and disposes",
    async (outcome) => {
      const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const secretBytes = new Uint8Array(32).fill(7);
      mockStoredIdentity(secretBytes);
      MOCKS.createRecoveryFile.mockImplementation(() => {
        if (outcome === "exception") throw new Error("SECRET-RECOVERY-PASSWORD");
        return Result.err({ code: "recovery_file_failed" as const });
      });

      const result = await new LocalIdentityController().createRecoveryFile(
        PUBLIC_KEY,
        "a strong recovery password",
      );

      expect(Result.isError(result) && result.error.code).toBe("recovery_file_failed");
      expect(secretBytes).toEqual(new Uint8Array(32));
      expect(MOCKS.dispose).toHaveBeenCalledOnce();
      expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-RECOVERY-PASSWORD");
    },
  );

  it("preserves success when SDK cleanup fails", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    mockStoredIdentity(new Uint8Array(32).fill(1));
    MOCKS.createRecoveryFile.mockReturnValue(Result.ok(new Uint8Array(64)));
    MOCKS.dispose.mockImplementation(() => {
      throw new Error("SECRET-RECOVERY-CLEANUP-CANARY");
    });

    expectResultOk(
      await new LocalIdentityController().createRecoveryFile(
        PUBLIC_KEY,
        "a strong recovery password",
      ),
    );
    expect(warning).toHaveBeenCalledWith("identity.recovery_file.cleanup.failed", {
      operation: "pubky_dispose",
      diagnosticId: expect.any(String),
      errorName: "Error",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-RECOVERY-CLEANUP-CANARY");
  });
});

function mockStoredIdentity(secretBytes: Uint8Array) {
  return vi.spyOn(LocalStorageIdentityRepository.prototype, "read").mockReturnValue(
    Result.ok({
      identity: { publicIdentity: { publicKeyZ32: PUBLIC_KEY } },
      secretKey: {
        bytes: secretBytes,
        format: PUBKY_SECRET_KEY_FORMAT,
      } satisfies PubkySecretKeyMaterial,
    }),
  );
}
