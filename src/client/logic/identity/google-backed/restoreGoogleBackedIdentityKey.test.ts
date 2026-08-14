import { describe, expect, it } from "vitest";

import { RecordingPubkySdkAdapter } from "../../../../../test-utils/fakes/recordingPubkySdkAdapter";
import {
  TEST_PASSPORT_ENVELOPE,
  RecordingPassportFileCrypto,
} from "../../../../../test-utils/fakes/googleBackedIdentityTestDoubles";
import { expectResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import { RestoreGoogleBackedIdentityKey } from "./restoreGoogleBackedIdentityKey";

describe("RestoreGoogleBackedIdentityKey", () => {
  it("decrypts, restores, and clears the plaintext key bytes", async () => {
    const setup = createSetup();

    expectResultOk(await setup.subject.execute(TEST_PASSPORT_ENVELOPE, "w".repeat(43)));

    expect(setup.pubky.restoreCalls).toHaveLength(1);
    expect(setup.crypto.decryptedOutputIsZeroed()).toBe(true);
  });

  it("maps key restoration failure and still clears plaintext bytes", async () => {
    const setup = createSetup();
    setup.pubky.restoreFailure = "restore_failed";

    expectResultError(
      await setup.subject.execute(TEST_PASSPORT_ENVELOPE, "w".repeat(43)),
      { code: "restore_failed" },
    );
    expect(setup.crypto.decryptedOutputIsZeroed()).toBe(true);
  });
});

function createSetup() {
  const pubky = new RecordingPubkySdkAdapter();
  const crypto = new RecordingPassportFileCrypto();
  return {
    subject: new RestoreGoogleBackedIdentityKey({
      decryptSecretKeyBytes: (input) => crypto.decryptSecretKeyBytes(input),
      pubky,
      passportOrigin: "https://passport.pubky.app",
    }),
    pubky,
    crypto,
  };
}
