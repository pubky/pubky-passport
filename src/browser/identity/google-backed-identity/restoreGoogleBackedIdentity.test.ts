import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { RecordingPubkySdkAdapter } from "../../../../test-utils/fakes/recordingPubkySdkAdapter";
import {
  TEST_PASSPORT_ENVELOPE,
  RecordingSaveLocalIdentity,
  RecordingPassportFileCrypto,
} from "../../../../test-utils/fakes/googleBackedIdentityTestDoubles";
import { expectResultError, expectResultOk } from "../../../../test-utils/resultAssertions";
import { RestoreGoogleBackedIdentity } from "./restoreGoogleBackedIdentity";

describe("RestoreGoogleBackedIdentity", () => {
  it("decrypts, signs in with discovery blocking, and saves the restored identity", async () => {
    const setup = createSetup();

    const result = await setup.subject.execute(...EXECUTION_INPUT);

    expectResultOk(result);
    expect(setup.pubky.createCalls).toBe(0);
    expect(setup.pubky.restoreCalls).toHaveLength(1);
    expect(setup.local.saveCalls).toBe(1);
    expect(setup.pubky.signinCalls).toHaveLength(1);
    expect(setup.pubky.signinCalls[0]).toMatchObject({
      waitForDiscovery: true,
    });
    expect(setup.crypto.decryptedOutputIsZeroed()).toBe(true);
    expect(setup.pubky.disposedKeys).toHaveLength(1);
  });

  it("stops a failed signin without saving locally", async () => {
    const setup = createSetup();
    setup.pubky.signinFailure = "signin_failed";

    const result = await setup.subject.execute(...EXECUTION_INPUT);

    expectResultError(result, { code: "signin_failed" });
    if (Result.isError(result)) expect(result.error.partialSetupPublicIdentity).toBeUndefined();
    expect(setup.local.saveCalls).toBe(0);
    expect(setup.pubky.disposedKeys).toHaveLength(1);
  });

  it("rejects a signin session for a different identity before local save", async () => {
    const setup = createSetup();
    setup.pubky.session.publicIdentity = {
      publicKeyZ32: "different-session-identity",
      publicKeyDisplay: "pubkydifferent-session-identity",
    };

    const result = await setup.subject.execute(...EXECUTION_INPUT);

    expectResultError(result, { code: "identity_mismatch" });
    if (Result.isError(result)) expect(result.error.partialSetupPublicIdentity).toBeUndefined();
    expect(setup.local.saveCalls).toBe(0);
  });

  it("maps decryption failure without attempting key restoration", async () => {
    const setup = createSetup();
    setup.crypto.decryptFailure = true;

    const result = await setup.subject.execute(...EXECUTION_INPUT);

    expectResultError(result, { code: "decrypt_failed" });
    expect(setup.pubky.restoreCalls).toEqual([]);
  });

  it("returns local save failures without partial-setup metadata", async () => {
    const setup = createSetup();
    setup.local.saveFailure = true;

    const result = await setup.subject.execute(...EXECUTION_INPUT);

    expectResultError(result, { code: "local_save_failed" });
    if (Result.isError(result)) expect(result.error.partialSetupPublicIdentity).toBeUndefined();
  });

  it.each(["signin", "local-save"] as const)(
    "disposes the restored key once and zeroes decrypted bytes when %s throws",
    async (stage) => {
      const setup = createSetup();
      if (stage === "signin") {
        setup.pubky.throwOnSignin = true;
      } else {
        setup.local.throwOnSave = true;
      }

      await expect(setup.subject.execute(...EXECUTION_INPUT)).rejects.toThrow();

      expect(setup.pubky.disposedKeys).toHaveLength(1);
      expect(setup.crypto.decryptedOutputIsZeroed()).toBe(true);
    },
  );

  it("preserves a successful outcome when key cleanup throws", async () => {
    const setup = createSetup();
    setup.pubky.throwOnDisposeIdentity = true;

    const result = await setup.subject.execute(...EXECUTION_INPUT);

    expectResultOk(result);
  });
});

const EXECUTION_INPUT = [TEST_PASSPORT_ENVELOPE, "w".repeat(43)] as const;

function createSetup() {
  const pubky = new RecordingPubkySdkAdapter();
  pubky.session.publicIdentity = pubky.nextPublicIdentity;
  const local = new RecordingSaveLocalIdentity();
  const crypto = new RecordingPassportFileCrypto();
  const subject = new RestoreGoogleBackedIdentity({
    decryptSecretKeyBytes: crypto.decryptSecretKeyBytes.bind(crypto),
    pubky,
    localIdentities: local,
    passportOrigin: "https://passport.pubky.app",
  });
  return { subject, pubky, local, crypto };
}
