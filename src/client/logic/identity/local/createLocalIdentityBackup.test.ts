import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../../../test-utils/fakes/MemoryStorage";
import { expectResultOk } from "../../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../../libs/logger/logger";
import { PUBKY_SECRET_KEY_FORMAT } from "../../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/PubkySdkAdapter";
import { CreateLocalIdentityBackup } from "./CreateLocalIdentityBackup";
import { LocalStorageIdentityRepository } from "./LocalStorageIdentityRepository";

describe("CreateLocalIdentityBackup", () => {
  it("creates an SDK recovery file for the requested local identity", async () => {
    const publicKeyZ32 = "x8jpihgjy51fdnaingcp8rum1omfzd6p8bhm7usune41grd97dho5cwy4mra";
    const repository = new LocalStorageIdentityRepository(new MemoryStorage());
    expectResultOk(repository.save(
      { id: publicKeyZ32, publicIdentity: { publicKeyDisplay: `pubky${publicKeyZ32}`, publicKeyZ32 } },
      { bytes: new Uint8Array(32).fill(7), format: PUBKY_SECRET_KEY_FORMAT },
    ));
    const createBackup = new CreateLocalIdentityBackup(
      (identityId) => repository.read(identityId),
    );

    const backup = expectResultOk(await createBackup.create(publicKeyZ32, "a strong backup password"));
    expect(backup.bytes.byteLength).toBeGreaterThan(32);
    expect(backup.fileName).toBe(`pubky-${publicKeyZ32}.pkarr`);
    backup.bytes.fill(0);
  });

  it("rejects weak passwords before reading local identity storage", async () => {
    const repository = new LocalStorageIdentityRepository(new MemoryStorage());
    const readIdentity = vi.spyOn(repository, "read");
    const createPubky = vi.fn(() => new PubkySdkAdapter());
    const createBackup = new CreateLocalIdentityBackup(
      (identityId) => repository.read(identityId),
      createPubky,
    );
    const result = await createBackup.create("identity", "short");

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "invalid_password" });
    expect(readIdentity).not.toHaveBeenCalled();
    expect(createPubky).not.toHaveBeenCalled();
  });

  it.each(["failure", "exception"] as const)(
    "zeros secret bytes and disposes the SDK adapter after an SDK %s",
    async (outcome) => {
      const secretKey = { bytes: new Uint8Array(32).fill(7), format: PUBKY_SECRET_KEY_FORMAT } as const;
      const readIdentity: LocalStorageIdentityRepository["read"] = () => Result.ok({
        identity: {
          id: "identity",
          publicIdentity: { publicKeyZ32: "identity", publicKeyDisplay: "pubkyidentity" },
        },
        secretKey,
      });
      const pubky = {
        createRecoveryFile: vi.fn(() => {
          if (outcome === "exception") throw new Error("recovery file failed");
          return Result.err({ code: "recovery_file_failed" as const });
        }),
        dispose: vi.fn(),
      };
      const createBackup = new CreateLocalIdentityBackup(readIdentity, () => pubky);

      const result = await createBackup.create("identity", "a strong backup password");

      expect(Result.isError(result) && result.error).toEqual({ code: "backup_failed" });
      expect(secretKey.bytes).toEqual(new Uint8Array(32));
      expect(pubky.dispose).toHaveBeenCalledOnce();
    },
  );

  it("zeros secret bytes and disposes the SDK adapter after success", async () => {
    const secretKey = { bytes: new Uint8Array(32).fill(7), format: PUBKY_SECRET_KEY_FORMAT } as const;
    const readIdentity: LocalStorageIdentityRepository["read"] = () => Result.ok({
      identity: {
        id: "identity",
        publicIdentity: { publicKeyZ32: "identity", publicKeyDisplay: "pubkyidentity" },
      },
      secretKey,
    });
    const recoveryBytes = new Uint8Array(64).fill(9);
    const pubky = {
      createRecoveryFile: vi.fn(() => Result.ok(recoveryBytes)),
      dispose: vi.fn(),
    };
    const createBackup = new CreateLocalIdentityBackup(readIdentity, () => pubky);

    const backup = expectResultOk(await createBackup.create("identity", "a strong backup password"));

    expect(backup.bytes).toBe(recoveryBytes);
    expect(secretKey.bytes).toEqual(new Uint8Array(32));
    expect(pubky.dispose).toHaveBeenCalledOnce();
  });

  it("preserves a successful backup when SDK cleanup throws", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const secretKey = { bytes: new Uint8Array(32).fill(7), format: PUBKY_SECRET_KEY_FORMAT } as const;
    const readIdentity: LocalStorageIdentityRepository["read"] = () => Result.ok({
      identity: {
        id: "identity",
        publicIdentity: { publicKeyZ32: "identity", publicKeyDisplay: "pubkyidentity" },
      },
      secretKey,
    });
    const createBackup = new CreateLocalIdentityBackup(readIdentity, () => ({
      createRecoveryFile: () => Result.ok(new Uint8Array(64).fill(9)),
      dispose: () => { throw new Error("cleanup failed"); },
    }));

    expectResultOk(await createBackup.create("identity", "a strong backup password"));

    expect(secretKey.bytes).toEqual(new Uint8Array(32));
    expect(warning).toHaveBeenCalledWith("identity.local_backup.cleanup.failed", {
      operation: "pubky_dispose",
    });
  });
});
