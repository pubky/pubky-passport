/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../../test-utils/fakes/MemoryStorage";
import { expectResultOk } from "../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../libs/logger/logger";
import { PUBKY_SECRET_KEY_FORMAT } from "../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../pubky/PubkySdkAdapter";
import { LocalIdentityController } from "./LocalIdentityController";
import { LocalStorageIdentityRepository } from "./LocalStorageIdentityRepository";

describe("LocalIdentityController", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists local identities", () => {
    const controller = createController();

    expect(controller.listIdentities()).toEqual(Result.ok({
      activePublicKeyZ32: null,
      identities: [],
    }));
  });

  it("creates a Ring migration URL for the requested identity and clears the returned secret bytes", () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => index);
    const readIdentity = vi.spyOn(LocalStorageIdentityRepository.prototype, "read").mockReturnValue(Result.ok({
      identity: {
        publicIdentity: { publicKeyZ32: "expected", publicKeyDisplay: "pubkyexpected" },
      },
      secretKey: { bytes, format: PUBKY_SECRET_KEY_FORMAT },
    }));
    const controller = createController();

    expect(controller.createPubkyRingMigrationUrl("expected")).toEqual(Result.ok(
      "pubkyring://migrate?index=0&total=1&key=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    ));
    expect(readIdentity).toHaveBeenCalledWith("expected");
    expect(bytes).toEqual(new Uint8Array(32));
  });

  it("exports the requested identity when a different identity is active", () => {
    const requestedPublicKey = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
    const activePublicKey = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
    const repository = new LocalStorageIdentityRepository();
    expectResultOk(repository.save(
      { publicIdentity: { publicKeyDisplay: `pubky${requestedPublicKey}`, publicKeyZ32: requestedPublicKey } },
      { bytes: new Uint8Array(32).fill(1), format: PUBKY_SECRET_KEY_FORMAT },
    ));
    expectResultOk(repository.save(
      { publicIdentity: { publicKeyDisplay: `pubky${activePublicKey}`, publicKeyZ32: activePublicKey } },
      { bytes: new Uint8Array(32).fill(2), format: PUBKY_SECRET_KEY_FORMAT },
    ));

    expect(createController().createPubkyRingMigrationUrl(requestedPublicKey)).toEqual(Result.ok(
      `pubkyring://migrate?index=0&total=1&key=${"01".repeat(32)}`,
    ));
  });

  it("preserves a requested identity read failure", () => {
    const controller = createController();

    const migration = controller.createPubkyRingMigrationUrl("missing");

    expect(Result.isError(migration)).toBe(true);
    if (Result.isError(migration)) {
      expect(migration.error).toEqual({ code: "invalid_identity" });
    }
  });

  it("creates an SDK recovery file for the requested local identity", async () => {
    const publicKeyZ32 = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
    const repository = new LocalStorageIdentityRepository();
    expectResultOk(repository.save(
      { publicIdentity: { publicKeyDisplay: `pubky${publicKeyZ32}`, publicKeyZ32 } },
      { bytes: new Uint8Array(32).fill(7), format: PUBKY_SECRET_KEY_FORMAT },
    ));
    const controller = createController();

    const backup = expectResultOk(
      await controller.createEncryptedBackup(publicKeyZ32, "a strong backup password"),
    );

    expect(backup.bytes.byteLength).toBeGreaterThan(32);
    expect(backup.fileName).toBe(`pubky-${publicKeyZ32}.pkarr`);
    backup.bytes.fill(0);
  });

  it("rejects weak backup passwords before reading local identity storage", async () => {
    const readIdentity = vi.spyOn(LocalStorageIdentityRepository.prototype, "read");
    const createRecoveryFile = vi.spyOn(PubkySdkAdapter.prototype, "createRecoveryFile");
    const controller = createController();

    const result = await controller.createEncryptedBackup("identity", "short");

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "invalid_password" });
    expect(readIdentity).not.toHaveBeenCalled();
    expect(createRecoveryFile).not.toHaveBeenCalled();
  });

  it.each(["failure", "exception"] as const)(
    "zeros secret bytes and disposes the SDK adapter after a backup SDK %s",
    async (outcome) => {
      const secretKey = { bytes: new Uint8Array(32).fill(7), format: PUBKY_SECRET_KEY_FORMAT } as const;
      vi.spyOn(LocalStorageIdentityRepository.prototype, "read").mockReturnValue(Result.ok({
        identity: {
          publicIdentity: { publicKeyZ32: "identity", publicKeyDisplay: "pubkyidentity" },
        },
        secretKey,
      }));
      const createRecoveryFile = vi.spyOn(PubkySdkAdapter.prototype, "createRecoveryFile")
        .mockImplementation(() => {
          if (outcome === "exception") throw new Error("recovery file failed");
          return Result.err({ code: "recovery_file_failed" as const });
        });
      const dispose = vi.spyOn(PubkySdkAdapter.prototype, "dispose");
      const controller = createController();

      const result = await controller.createEncryptedBackup("identity", "a strong backup password");

      expect(Result.isError(result) && result.error).toEqual({ code: "backup_failed" });
      expect(secretKey.bytes).toEqual(new Uint8Array(32));
      expect(createRecoveryFile).toHaveBeenCalledOnce();
      expect(dispose).toHaveBeenCalledOnce();
    },
  );

  it("zeros secret bytes and disposes the SDK adapter after a successful backup", async () => {
    const secretKey = { bytes: new Uint8Array(32).fill(7), format: PUBKY_SECRET_KEY_FORMAT } as const;
    vi.spyOn(LocalStorageIdentityRepository.prototype, "read").mockReturnValue(Result.ok({
      identity: {
        publicIdentity: { publicKeyZ32: "identity", publicKeyDisplay: "pubkyidentity" },
      },
      secretKey,
    }));
    const recoveryBytes = new Uint8Array(64).fill(9);
    vi.spyOn(PubkySdkAdapter.prototype, "createRecoveryFile").mockReturnValue(Result.ok(recoveryBytes));
    const dispose = vi.spyOn(PubkySdkAdapter.prototype, "dispose");
    const controller = createController();

    const backup = expectResultOk(
      await controller.createEncryptedBackup("identity", "a strong backup password"),
    );

    expect(backup.bytes).toBe(recoveryBytes);
    expect(secretKey.bytes).toEqual(new Uint8Array(32));
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("preserves a successful backup when SDK cleanup throws", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const secretKey = { bytes: new Uint8Array(32).fill(7), format: PUBKY_SECRET_KEY_FORMAT } as const;
    vi.spyOn(LocalStorageIdentityRepository.prototype, "read").mockReturnValue(Result.ok({
      identity: {
        publicIdentity: { publicKeyZ32: "identity", publicKeyDisplay: "pubkyidentity" },
      },
      secretKey,
    }));
    vi.spyOn(PubkySdkAdapter.prototype, "createRecoveryFile")
      .mockReturnValue(Result.ok(new Uint8Array(64).fill(9)));
    vi.spyOn(PubkySdkAdapter.prototype, "dispose").mockImplementation(() => {
      throw new Error("cleanup failed");
    });
    const controller = createController();

    expectResultOk(await controller.createEncryptedBackup("identity", "a strong backup password"));

    expect(secretKey.bytes).toEqual(new Uint8Array(32));
    expect(warning).toHaveBeenCalledWith("identity.local_backup.cleanup.failed", {
      operation: "pubky_dispose",
    });
  });

});

function createController(): LocalIdentityController {
  return new LocalIdentityController();
}
