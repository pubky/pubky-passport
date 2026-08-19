import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecordingPubkySdkAdapter } from "../../../../test-utils/fakes/RecordingPubkySdkAdapter";
import { expectAsyncResultError, expectResultOk } from "../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../libs/logger/logger";
import { PUBKY_SECRET_KEY_FORMAT, type PubkySecretKeyMaterial } from "../pubky/pubkyIdentityKey";
import type { LocalIdentityMetadata } from "../local-identity/localIdentityModels";
import type { LocalIdentityResult } from "../local-identity/LocalStorageIdentityRepository";
import { restoreActiveLocalIdentity } from "./ActiveIdentityAuthorization";

describe("restoreActiveLocalIdentity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores the active key, verifies public metadata, and zeros read bytes", async () => {
    const pubky = new RecordingPubkySdkAdapter();
    const { readActive, state } = createReadActive();
    state.activeIdentity = { publicIdentity: pubky.nextPublicIdentity };
    expectResultOk(await restoreActiveLocalIdentity(pubky, readActive));

    expect(state.activeSecret.bytes.every((byte) => byte === 0)).toBe(true);
    expect(pubky.disposedKeys).toEqual([]);
  });

  it("disposes a restored key whose public identity does not match storage", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const pubky = new RecordingPubkySdkAdapter();
    const { readActive, state } = createReadActive();
    state.activeIdentity = {
      publicIdentity: { ...pubky.nextPublicIdentity, publicKeyDisplay: "pubkywrong" },
    };
    await expectAsyncResultError(
      restoreActiveLocalIdentity(pubky, readActive),
      { code: "identity_mismatch" },
    );

    expect(pubky.disposedKeys).toHaveLength(1);
    expect(state.activeSecret.bytes.every((byte) => byte === 0)).toBe(true);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("identity.local_restore.failed", {
      code: "identity_mismatch",
    });
  });

  it("rejects a stored z32 public key that does not match the restored key", async () => {
    const pubky = new RecordingPubkySdkAdapter();
    const { readActive, state } = createReadActive();
    state.activeIdentity = {
      publicIdentity: { ...pubky.nextPublicIdentity, publicKeyZ32: "different-public-key" },
    };

    await expectAsyncResultError(
      restoreActiveLocalIdentity(pubky, readActive),
      { code: "identity_mismatch" },
    );

    expect(pubky.disposedKeys).toHaveLength(1);
    expect(state.activeSecret.bytes.every((byte) => byte === 0)).toBe(true);
  });

  it("maps typed SDK restoration failures and clears secret bytes", async () => {
    const pubky = new RecordingPubkySdkAdapter();
    pubky.restoreFailure = "restore_failed";
    const { readActive, state } = createReadActive();
    state.activeIdentity = { publicIdentity: pubky.nextPublicIdentity };
    await expectAsyncResultError(
      restoreActiveLocalIdentity(pubky, readActive),
      { code: "restore_failed" },
    );
    expect(state.activeSecret.bytes.every((byte) => byte === 0)).toBe(true);
  });
});

function createReadActive(): {
  readActive: () => LocalIdentityResult<{ identity: LocalIdentityMetadata; secretKey: PubkySecretKeyMaterial }>;
  state: { activeIdentity: LocalIdentityMetadata | null; activeSecret: PubkySecretKeyMaterial };
} {
  const state = {
    activeIdentity: null as LocalIdentityMetadata | null,
    activeSecret: { bytes: new Uint8Array(32).fill(7), format: PUBKY_SECRET_KEY_FORMAT } as PubkySecretKeyMaterial,
  };
  const readActive = vi.fn((): LocalIdentityResult<{
    identity: LocalIdentityMetadata;
    secretKey: PubkySecretKeyMaterial;
  }> => state.activeIdentity
      ? Result.ok({ identity: state.activeIdentity, secretKey: state.activeSecret })
      : Result.err({ code: "no_active_identity" }));

  return { readActive, state };
}
