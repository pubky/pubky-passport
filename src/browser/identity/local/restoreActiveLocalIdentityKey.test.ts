import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecordingPubkySdkAdapter } from "../../../../test-utils/fakes/recordingPubkySdkAdapter";
import { expectAsyncResultError, expectResultOk } from "../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../libs/logger/logger";
import { PUBKY_SECRET_KEY_FORMAT, type PubkySecretKeyMaterial } from "../../pubky/pubkyIdentityKey";
import type {
  LocalIdentityResult,
  LocalIdentitySummary,
} from "./localStorageIdentityRepository";
import { RestoreActiveLocalIdentityKey } from "./restoreActiveLocalIdentityKey";

describe("RestoreActiveLocalIdentityKey", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores the active key, verifies public metadata, and zeros read bytes", async () => {
    const pubky = new RecordingPubkySdkAdapter();
    const { readActive, state } = createReadActive();
    state.activeIdentity = { id: pubky.nextPublicIdentity.publicKeyZ32, publicIdentity: pubky.nextPublicIdentity };
    const restore = new RestoreActiveLocalIdentityKey({
      readActive,
      pubky,
    });

    expectResultOk(await restore.restore());

    expect(state.activeSecret.bytes.every((byte) => byte === 0)).toBe(true);
    expect(pubky.disposedKeys).toEqual([]);
  });

  it("disposes a restored key whose public identity does not match storage", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const pubky = new RecordingPubkySdkAdapter();
    const { readActive, state } = createReadActive();
    state.activeIdentity = {
      id: pubky.nextPublicIdentity.publicKeyZ32,
      publicIdentity: { ...pubky.nextPublicIdentity, publicKeyDisplay: "pubkywrong" },
    };
    const restore = new RestoreActiveLocalIdentityKey({
      readActive,
      pubky,
    });

    await expectAsyncResultError(restore.restore(), { code: "identity_mismatch" });

    expect(pubky.disposedKeys).toHaveLength(1);
    expect(state.activeSecret.bytes.every((byte) => byte === 0)).toBe(true);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("identity.local_restore.failed", {
      code: "identity_mismatch",
    });
  });

  it("maps typed SDK restoration failures and clears secret bytes", async () => {
    const pubky = new RecordingPubkySdkAdapter();
    pubky.restoreFailure = "restore_failed";
    const { readActive, state } = createReadActive();
    state.activeIdentity = { id: pubky.nextPublicIdentity.publicKeyZ32, publicIdentity: pubky.nextPublicIdentity };
    const restore = new RestoreActiveLocalIdentityKey({ readActive, pubky });

    await expectAsyncResultError(restore.restore(), { code: "restore_failed" });
    expect(state.activeSecret.bytes.every((byte) => byte === 0)).toBe(true);
  });
});

function createReadActive(): {
  readActive: () => LocalIdentityResult<{ identity: LocalIdentitySummary; secretKey: PubkySecretKeyMaterial }>;
  state: { activeIdentity: LocalIdentitySummary | null; activeSecret: PubkySecretKeyMaterial };
} {
  const state = {
    activeIdentity: null as LocalIdentitySummary | null,
    activeSecret: { bytes: new Uint8Array(32).fill(7), format: PUBKY_SECRET_KEY_FORMAT } as PubkySecretKeyMaterial,
  };
  const readActive = vi.fn((): LocalIdentityResult<{
      identity: LocalIdentitySummary;
      secretKey: PubkySecretKeyMaterial;
    }> => state.activeIdentity
    ? Result.ok({ identity: state.activeIdentity, secretKey: state.activeSecret })
    : Result.err({ code: "no_active_identity" }));

  return { readActive, state };
}
