import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { FakePubkyIdentityKeys } from "../../../../test-utils/fakes/fakePubkyIdentityKeys";
import { expectAsyncResultError, expectResultOk } from "../../../../test-utils/resultAssertions";
import { pubkySecretKeyFormat, type PubkySecretKeyMaterial } from "../../pubky/ports";
import type { LocalIdentitySummary } from "./localIdentity";
import { LocalIdentityService } from "./localIdentityService";
import type { LocalIdentityRepository, LocalIdentityRepositoryResult } from "./ports/localIdentityRepository";

describe("LocalIdentityService", () => {
  it("exports, persists, and zeros secret bytes when saving", async () => {
    const keys = new FakePubkyIdentityKeys();
    const key = expectResultOk(await keys.createIdentityKey());
    const repository = new FakeLocalIdentityRepository();
    const service = new LocalIdentityService({ repository, identityKeys: keys });

    expectResultOk(await service.saveIdentity({ keyHandle: key.keyHandle }));

    expect(repository.savedSecret?.every((byte) => byte === 0)).toBe(true);
    expect(repository.savedIdentity).toEqual({ id: key.publicIdentity.publicKeyZ32, publicIdentity: key.publicIdentity });
  });

  it("restores the active key, verifies public metadata, and zeros read bytes", async () => {
    const keys = new FakePubkyIdentityKeys();
    const repository = new FakeLocalIdentityRepository();
    repository.activeIdentity = { id: keys.nextPublicIdentity.publicKeyZ32, publicIdentity: keys.nextPublicIdentity };
    const service = new LocalIdentityService({ repository, identityKeys: keys });

    expectResultOk(await service.restoreActiveIdentity());

    expect(repository.activeSecret.bytes.every((byte) => byte === 0)).toBe(true);
    expect(keys.disposedKeys).toEqual([]);
  });

  it("disposes a restored key whose public identity does not match storage", async () => {
    const keys = new FakePubkyIdentityKeys();
    const repository = new FakeLocalIdentityRepository();
    repository.activeIdentity = {
      id: keys.nextPublicIdentity.publicKeyZ32,
      publicIdentity: { ...keys.nextPublicIdentity, publicKeyDisplay: "pubkywrong" },
    };
    const service = new LocalIdentityService({ repository, identityKeys: keys });

    await expectAsyncResultError(service.restoreActiveIdentity(), { code: "identity_mismatch" });

    expect(keys.disposedKeys).toHaveLength(1);
    expect(repository.activeSecret.bytes.every((byte) => byte === 0)).toBe(true);
  });
});

class FakeLocalIdentityRepository implements LocalIdentityRepository {
  activeIdentity: LocalIdentitySummary | null = null;
  activeSecret: PubkySecretKeyMaterial = { bytes: new Uint8Array(32).fill(7), format: pubkySecretKeyFormat };
  savedIdentity?: LocalIdentitySummary;
  savedSecret?: Uint8Array;

  list() { return Result.ok({ activeIdentityId: this.activeIdentity?.id ?? null, identities: this.activeIdentity ? [this.activeIdentity] : [] }); }
  save(input: Parameters<LocalIdentityRepository["save"]>[0]) {
    this.savedIdentity = input.identity;
    this.savedSecret = input.secretKey.bytes;
    return Result.ok(input.identity);
  }
  select() { return Result.ok(); }
  clear() { return Result.ok(); }
  readActive(): LocalIdentityRepositoryResult<{ identity: LocalIdentitySummary; secretKey: PubkySecretKeyMaterial }> {
    return this.activeIdentity
      ? Result.ok({ identity: this.activeIdentity, secretKey: this.activeSecret })
      : Result.err({ code: "no_active_identity" });
  }
}
