import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { RecordingPubkyIdentityKeys } from "../../../../../test-utils/fakes/recordingPubkyIdentityKeys";
import { expectAsyncResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import { PUBKY_SECRET_KEY_FORMAT, type PubkySecretKeyMaterial } from "../../../pubky/application/pubkyIdentityKeys";
import type { LocalIdentitySummary } from "./localIdentity";
import type { LocalIdentityKeyStore, LocalIdentityRepositoryResult } from "./localIdentityRepository";
import { RestoreActiveLocalIdentityKey } from "./restoreActiveLocalIdentityKey";

describe("RestoreActiveLocalIdentityKey", () => {
  it("restores the active key, verifies public metadata, and zeros read bytes", async () => {
    const keys = new RecordingPubkyIdentityKeys();
    const { keyStore, state } = createMockLocalIdentityKeyStore();
    state.activeIdentity = { id: keys.nextPublicIdentity.publicKeyZ32, publicIdentity: keys.nextPublicIdentity };
    const restore = new RestoreActiveLocalIdentityKey({ keyStore, identityKeys: keys });

    expectResultOk(await restore.restore());

    expect(state.activeSecret.bytes.every((byte) => byte === 0)).toBe(true);
    expect(keys.disposedKeys).toEqual([]);
  });

  it("disposes a restored key whose public identity does not match storage", async () => {
    const keys = new RecordingPubkyIdentityKeys();
    const { keyStore, state } = createMockLocalIdentityKeyStore();
    state.activeIdentity = {
      id: keys.nextPublicIdentity.publicKeyZ32,
      publicIdentity: { ...keys.nextPublicIdentity, publicKeyDisplay: "pubkywrong" },
    };
    const restore = new RestoreActiveLocalIdentityKey({ keyStore, identityKeys: keys });

    await expectAsyncResultError(restore.restore(), { code: "identity_mismatch" });

    expect(keys.disposedKeys).toHaveLength(1);
    expect(state.activeSecret.bytes.every((byte) => byte === 0)).toBe(true);
  });
});

function createMockLocalIdentityKeyStore(): {
  keyStore: LocalIdentityKeyStore;
  state: { activeIdentity: LocalIdentitySummary | null; activeSecret: PubkySecretKeyMaterial };
} {
  const state = {
    activeIdentity: null as LocalIdentitySummary | null,
    activeSecret: { bytes: new Uint8Array(32).fill(7), format: PUBKY_SECRET_KEY_FORMAT } as PubkySecretKeyMaterial,
  };
  const keyStore: LocalIdentityKeyStore = {
    save: vi.fn((input) => Result.ok(input.identity)),
    readActive: vi.fn((): LocalIdentityRepositoryResult<{
      identity: LocalIdentitySummary;
      secretKey: PubkySecretKeyMaterial;
    }> => state.activeIdentity
      ? Result.ok({ identity: state.activeIdentity, secretKey: state.activeSecret })
      : Result.err({ code: "no_active_identity" })),
  };

  return { keyStore, state };
}
