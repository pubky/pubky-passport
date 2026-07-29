import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { FakePubkyIdentityKeys } from "../../../../../test-utils/fakes/fakePubkyIdentityKeys";
import { expectAsyncResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import { PUBKY_SECRET_KEY_FORMAT, type PubkySecretKeyMaterial } from "../../../pubky/application/pubkyIdentityKeys";
import type { LocalIdentitySummary } from "./localIdentity";
import type { LocalIdentityKeyStore, LocalIdentityRepositoryResult } from "./localIdentityRepository";
import { RestoreActiveLocalIdentityKey } from "./restoreActiveLocalIdentityKey";

describe("RestoreActiveLocalIdentityKey", () => {
  it("restores the active key, verifies public metadata, and zeros read bytes", async () => {
    const keys = new FakePubkyIdentityKeys();
    const keyStore = new FakeLocalIdentityKeyStore();
    keyStore.activeIdentity = { id: keys.nextPublicIdentity.publicKeyZ32, publicIdentity: keys.nextPublicIdentity };
    const restore = new RestoreActiveLocalIdentityKey({ keyStore, identityKeys: keys });

    expectResultOk(await restore.restore());

    expect(keyStore.activeSecret.bytes.every((byte) => byte === 0)).toBe(true);
    expect(keys.disposedKeys).toEqual([]);
  });

  it("disposes a restored key whose public identity does not match storage", async () => {
    const keys = new FakePubkyIdentityKeys();
    const keyStore = new FakeLocalIdentityKeyStore();
    keyStore.activeIdentity = {
      id: keys.nextPublicIdentity.publicKeyZ32,
      publicIdentity: { ...keys.nextPublicIdentity, publicKeyDisplay: "pubkywrong" },
    };
    const restore = new RestoreActiveLocalIdentityKey({ keyStore, identityKeys: keys });

    await expectAsyncResultError(restore.restore(), { code: "identity_mismatch" });

    expect(keys.disposedKeys).toHaveLength(1);
    expect(keyStore.activeSecret.bytes.every((byte) => byte === 0)).toBe(true);
  });
});

class FakeLocalIdentityKeyStore implements LocalIdentityKeyStore {
  activeIdentity: LocalIdentitySummary | null = null;
  activeSecret: PubkySecretKeyMaterial = { bytes: new Uint8Array(32).fill(7), format: PUBKY_SECRET_KEY_FORMAT };

  save(input: Parameters<LocalIdentityKeyStore["save"]>[0]) { return Result.ok(input.identity); }
  readActive(): LocalIdentityRepositoryResult<{ identity: LocalIdentitySummary; secretKey: PubkySecretKeyMaterial }> {
    return this.activeIdentity
      ? Result.ok({ identity: this.activeIdentity, secretKey: this.activeSecret })
      : Result.err({ code: "no_active_identity" });
  }
}
