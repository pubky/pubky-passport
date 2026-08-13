import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { RecordingPubkySdkAdapter } from "../../../../../test-utils/fakes/recordingPubkySdkAdapter";
import {
  TEST_PASSPORT_ENVELOPE,
  RecordingSaveLocalIdentity,
  RecordingPassportFileCrypto,
} from "../../../../../test-utils/fakes/googleBackedIdentityTestDoubles";
import { expectResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import { RestoreGoogleBackedIdentity } from "./restoreGoogleBackedIdentity";

describe("RestoreGoogleBackedIdentity", () => {
  it("decrypts, signs in, confirms discovery, and saves the restored identity", async () => {
    const setup = createSetup();
    const progress: string[] = [];

    const result = await setup.subject.execute(...executionInput((phase) => progress.push(phase)));

    expectResultOk(result);
    expect(setup.pubky.createCalls).toBe(0);
    expect(setup.pubky.restoreCalls).toHaveLength(1);
    expect(setup.local.saveCalls).toBe(1);
    expect(setup.pubky.signinCalls).toBe(1);
    expect(setup.pubky.discoveryCalls).toEqual([{ hasHomeserverPubky: false }]);
    expect(setup.crypto.decryptedOutputIsZeroed()).toBe(true);
    expect(setup.pubky.disposedKeys).toHaveLength(1);
    expect(progress).toEqual(["restoring_identity", "activating_restored_identity"]);
  });

  it("stops a failed signin without saving locally", async () => {
    const setup = createSetup();
    setup.pubky.signinFailure = "signin_failed";

    const result = await setup.subject.execute(...EXECUTION_INPUT);

    expectResultError(result, {
      code: "signin_failed",
      preservedPassportFileIdentity: setup.pubky.nextPublicIdentity,
    });
    expect(setup.local.saveCalls).toBe(0);
    expect(setup.pubky.disposedKeys).toHaveLength(1);
    expect(setup.pubky.discoveryCalls).toEqual([]);
  });

  it("rejects a signin session for a different identity before local save", async () => {
    const setup = createSetup();
    setup.pubky.session.publicIdentity = {
      publicKeyZ32: "different-session-identity",
      publicKeyDisplay: "pubkydifferent-session-identity",
    };

    const result = await setup.subject.execute(...EXECUTION_INPUT);

    expectResultError(result, {
      code: "identity_mismatch",
      preservedPassportFileIdentity: setup.pubky.nextPublicIdentity,
    });
    expect(setup.local.saveCalls).toBe(0);
    expect(setup.pubky.discoveryCalls).toEqual([]);
  });

  it("re-resolves discovery once after a publication race", async () => {
    const setup = createSetup();
    const publish = setup.pubky.publishHomeserverIfStale.bind(setup.pubky);
    let attempts = 0;
    setup.pubky.publishHomeserverIfStale = async (input) => {
      attempts += 1;
      return attempts === 1 ? Result.err({ code: "publish_failed" }) : publish(input);
    };

    expectResultOk(await setup.subject.execute(...EXECUTION_INPUT));

    expect(setup.pubky.signinCalls).toBe(1);
    expect(attempts).toBe(2);
    expect(setup.local.saveCalls).toBe(1);
  });

  it("does not save when discovery still fails after a fresh-resolution retry", async () => {
    const setup = createSetup();
    setup.pubky.discoveryFailure = "publish_failed";

    const result = await setup.subject.execute(...EXECUTION_INPUT);

    expectResultError(result, {
      code: "discovery_failed",
      preservedPassportFileIdentity: setup.pubky.nextPublicIdentity,
    });
    expect(setup.pubky.signinCalls).toBe(1);
    expect(setup.pubky.discoveryCalls).toHaveLength(2);
    expect(setup.local.saveCalls).toBe(0);
  });

  it("maps decryption failure without attempting key restoration", async () => {
    const setup = createSetup();
    setup.crypto.decryptFailure = true;

    const result = await setup.subject.execute(...EXECUTION_INPUT);

    expectResultError(result, { code: "decrypt_failed" });
    expect(setup.pubky.restoreCalls).toEqual([]);
  });

  it("returns a cleanup candidate when local save fails", async () => {
    const setup = createSetup();
    setup.local.saveFailure = true;

    const result = await setup.subject.execute(...EXECUTION_INPUT);

    expectResultError(result, {
      code: "local_save_failed",
      preservedPassportFileIdentity: setup.pubky.nextPublicIdentity,
    });
  });

  it.each(["signin", "discovery", "local-save"] as const)(
    "disposes the restored key once and zeroes decrypted bytes when %s throws",
    async (stage) => {
      const setup = createSetup();
      if (stage === "signin") {
        setup.pubky.throwOnSignin = true;
      } else if (stage === "discovery") {
        setup.pubky.throwOnDiscovery = true;
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

const EXECUTION_INPUT = executionInput();

function executionInput(
  reportProgress: Parameters<RestoreGoogleBackedIdentity["execute"]>[2] = () => { },
) {
  return [TEST_PASSPORT_ENVELOPE, "w".repeat(43), reportProgress] as const;
}

function createSetup() {
  const pubky = new RecordingPubkySdkAdapter();
  pubky.session.publicIdentity = pubky.nextPublicIdentity;
  const local = new RecordingSaveLocalIdentity();
  const crypto = new RecordingPassportFileCrypto();
  const subject = new RestoreGoogleBackedIdentity({
    decryptSecretKeyBytes: crypto.decryptSecretKeyBytes.bind(crypto),
    pubky,
    saveLocalIdentity: local,
    passportOrigin: "https://passport.pubky.app",
  });
  return { subject, pubky, local, crypto };
}
