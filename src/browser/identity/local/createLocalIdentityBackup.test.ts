import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../../test-utils/fakes/memoryStorage";
import { expectResultOk } from "../../../../test-utils/resultAssertions";
import { PUBKY_SECRET_KEY_FORMAT } from "../../pubky/pubkyIdentityKey";
import { createLocalIdentityBackup } from "./createLocalIdentityBackup";
import { LocalStorageIdentityRepository } from "./localStorageIdentityRepository";

describe("createLocalIdentityBackup", () => {
  it("creates an SDK recovery file for the requested local identity", async () => {
    const publicKeyZ32 = "x8jpihgjy51fdnaingcp8rum1omfzd6p8bhm7usune41grd97dho5cwy4mra";
    const repository = new LocalStorageIdentityRepository(new MemoryStorage());
    expectResultOk(repository.save(
      { id: publicKeyZ32, publicIdentity: { publicKeyDisplay: `pubky${publicKeyZ32}`, publicKeyZ32 } },
      { bytes: new Uint8Array(32).fill(7), format: PUBKY_SECRET_KEY_FORMAT },
    ));

    const backup = expectResultOk(await createLocalIdentityBackup(repository.read.bind(repository), publicKeyZ32, "a strong backup password"));
    expect(backup.bytes.byteLength).toBeGreaterThan(32);
    expect(backup.fileName).toBe(`pubky-${publicKeyZ32}.pkarr`);
    backup.bytes.fill(0);
  });

  it("rejects weak passwords before reading local identity storage", async () => {
    const readIdentity = vi.fn(() => Result.err({ code: "invalid_identity" as const }));
    const result = await createLocalIdentityBackup(readIdentity, "identity", "short");

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "invalid_password" });
    expect(readIdentity).not.toHaveBeenCalled();
  });
});
