import { describe, expect, it } from "vitest";

import { FakePubkyIdentityKeys } from "../../../../../test-utils/fakes/fakePubkyIdentityKeys";
import { FakePubkySessionAccess } from "../../../../../test-utils/fakes/fakePubkySessionAccess";
import {
  fakePassportEnvelope,
  FakeLocalIdentitySaver,
  FakePassportCrypto,
} from "../../../../../test-utils/fakes/googleBackedIdentityFakes";
import { expectResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import { RestoreGoogleBackedIdentity } from "./restoreGoogleBackedIdentity";

describe("RestoreGoogleBackedIdentity", () => {
  it("decrypts, signs in with discovery blocking, and saves the restored identity", async () => {
    const setup = createSetup();

    const result = await setup.subject.execute(executionInput);

    expectResultOk(result);
    expect(setup.keys.createCalls).toBe(0);
    expect(setup.keys.restoreCalls).toHaveLength(1);
    expect(setup.local.saveCalls).toBe(1);
    expect(setup.sessionAccess.signinCalls).toHaveLength(1);
    expect(setup.sessionAccess.signinCalls[0]).toMatchObject({
      waitForDiscovery: true,
    });
    expect(setup.crypto.decryptedOutputIsZeroed()).toBe(true);
    expect(setup.keys.disposedKeys).toHaveLength(1);
  });

  it("stops a failed signin without saving locally", async () => {
    const setup = createSetup();
    setup.sessionAccess.signinFailure = "signin_failed";

    const result = await setup.subject.execute(executionInput);

    expectResultError(result, {
      code: "signin_failed",
      recoverablePublicIdentity: setup.keys.nextPublicIdentity,
    });
    expect(setup.local.saveCalls).toBe(0);
    expect(setup.keys.disposedKeys).toHaveLength(1);
  });

  it("rejects a signin session for a different identity before local save", async () => {
    const setup = createSetup();
    setup.sessionAccess.session.publicIdentity = {
      publicKeyZ32: "different-session-identity",
      publicKeyDisplay: "pubkydifferent-session-identity",
    };

    const result = await setup.subject.execute(executionInput);

    expectResultError(result, {
      code: "identity_mismatch",
      recoverablePublicIdentity: setup.keys.nextPublicIdentity,
    });
    expect(setup.local.saveCalls).toBe(0);
  });

  it("maps decryption failure without attempting key restoration", async () => {
    const setup = createSetup();
    setup.crypto.decryptFailure = true;

    const result = await setup.subject.execute(executionInput);

    expectResultError(result, { code: "decrypt_failed" });
    expect(setup.keys.restoreCalls).toEqual([]);
  });

  it.each(["signin", "local-save"] as const)(
    "disposes the restored key once and zeroes decrypted bytes when %s throws",
    async (stage) => {
      const setup = createSetup();
      if (stage === "signin") {
        setup.sessionAccess.signin = async () => { throw new Error("signin threw"); };
      } else {
        setup.local.throwOnSave = true;
      }

      await expect(setup.subject.execute(executionInput)).rejects.toThrow();

      expect(setup.keys.disposedKeys).toHaveLength(1);
      expect(setup.crypto.decryptedOutputIsZeroed()).toBe(true);
    },
  );

  it("preserves a successful outcome when key cleanup throws", async () => {
    const setup = createSetup();
    setup.keys.disposeIdentityKey = () => { throw new Error("cleanup failed"); };

    const result = await setup.subject.execute(executionInput);

    expectResultOk(result);
  });
});

const executionInput = {
  envelope: fakePassportEnvelope,
  wrappingKey: "w".repeat(43),
};

function createSetup() {
  const keys = new FakePubkyIdentityKeys();
  const sessionAccess = new FakePubkySessionAccess();
  sessionAccess.session.publicIdentity = keys.nextPublicIdentity;
  const local = new FakeLocalIdentitySaver();
  const crypto = new FakePassportCrypto();
  const subject = new RestoreGoogleBackedIdentity({
    crypto,
    identityKeys: keys,
    sessionAccess,
    localIdentities: local,
    passportOrigin: "https://passport.pubky.app",
  });
  return { subject, keys, sessionAccess, local, crypto };
}
