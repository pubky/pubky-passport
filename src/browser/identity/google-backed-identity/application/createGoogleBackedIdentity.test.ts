import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { RecordingPubkyDiscovery } from "../../../../../test-utils/fakes/recordingPubkyDiscovery";
import { RecordingPubkyIdentityKeys } from "../../../../../test-utils/fakes/recordingPubkyIdentityKeys";
import { RecordingPubkySessionAccess } from "../../../../../test-utils/fakes/recordingPubkySessionAccess";
import {
  TEST_SIGNUP_INVITATION,
  RecordingSaveLocalIdentity,
  RecordingPassportFileCrypto,
  SanitizedPassportFileStore,
} from "../../../../../test-utils/fakes/googleBackedIdentityTestDoubles";
import { expectResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import { CreateGoogleBackedIdentity } from "./createGoogleBackedIdentity";

describe("CreateGoogleBackedIdentity", () => {
  it("encrypts, stores, activates, and saves a new identity in order", async () => {
    const events: string[] = [];
    const setup = createSetup({
      fileStore: new SanitizedPassportFileStore({ status: "missing" }, () => events.push("drive-create")),
      local: new RecordingSaveLocalIdentity(() => events.push("save")),
    });
    const signup = setup.sessionAccess.signup.bind(setup.sessionAccess);
    setup.sessionAccess.signup = async (input) => {
      events.push("signup");
      return signup(input);
    };
    const publish = setup.discovery.publishHomeserverIfStale.bind(setup.discovery);
    setup.discovery.publishHomeserverIfStale = async (input) => {
      events.push("discovery");
      return publish(input);
    };

    const result = await setup.subject.execute(executionInput(setup.fileStore));

    expectResultOk(result);
    expect(setup.keys.createCalls).toBe(1);
    expect(setup.fileStore.createdFiles).toEqual([{
      version: 1,
      url: "https://passport.pubky.app",
      ivCharacters: 16,
      ciphertextCharacters: 64,
    }]);
    expect(setup.local.saveCalls).toBe(1);
    expect(setup.sessionAccess.signupCalls).toHaveLength(1);
    expect(setup.sessionAccess.signupCalls[0]).toMatchObject({
      homeserverPubky: "homegate-homeserver",
      hasSignupCode: true,
    });
    expect(setup.discovery.calls).toHaveLength(1);
    expect(setup.discovery.calls[0]).toMatchObject({
      homeserverPubky: "homegate-homeserver",
    });
    expect(events).toEqual(["drive-create", "signup", "discovery", "save"]);
    expect(setup.crypto.encryptedInputIsZeroed()).toBe(true);
    expect(setup.keys.disposedKeys).toHaveLength(1);
  });

  it("maps a Drive create conflict and disposes the unpersisted key", async () => {
    const setup = createSetup();
    setup.fileStore.createFailure = "create_conflict";

    const result = await setup.subject.execute(executionInput(setup.fileStore));

    expectResultError(result, { code: "drive_create_conflict" });
    expect(setup.keys.disposedKeys).toHaveLength(1);
    expect(setup.crypto.encryptedInputIsZeroed()).toBe(true);
  });

  it.each(["encrypt", "drive-write"] as const)(
    "does not expose a recoverable identity when %s fails before a Drive file exists",
    async (stage) => {
      const setup = createSetup();
      if (stage === "encrypt") {
        setup.crypto.encryptFailure = true;
      } else {
        setup.fileStore.createFailure = "write_failed";
      }

      const result = await setup.subject.execute(executionInput(setup.fileStore));

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) expect(result.error.partialSetupPublicIdentity).toBeUndefined();
      expect(setup.keys.disposedKeys).toHaveLength(1);
      expect(setup.crypto.encryptedInputIsZeroed()).toBe(true);
    },
  );

  it("returns a recoverable identity when signup fails after Drive creation", async () => {
    const setup = createSetup();
    setup.sessionAccess.signupFailure = "signup_failed";

    const result = await setup.subject.execute(executionInput(setup.fileStore));

    expectResultError(result, {
      code: "signup_failed",
      partialSetupPublicIdentity: setup.keys.nextPublicIdentity,
    });
    expect(setup.discovery.calls).toEqual([]);
    expect(setup.local.saveCalls).toBe(0);
    expect(setup.keys.disposedKeys).toHaveLength(1);
  });

  it("rejects a signup session for a different identity before discovery or local save", async () => {
    const setup = createSetup();
    setup.sessionAccess.session.publicIdentity = {
      publicKeyZ32: "different-session-identity",
      publicKeyDisplay: "pubkydifferent-session-identity",
    };

    const result = await setup.subject.execute(executionInput(setup.fileStore));

    expectResultError(result, {
      code: "identity_mismatch",
      partialSetupPublicIdentity: setup.keys.nextPublicIdentity,
    });
    expect(setup.discovery.calls).toEqual([]);
    expect(setup.local.saveCalls).toBe(0);
  });

  it("does not save locally when discovery publication fails", async () => {
    const setup = createSetup();
    setup.discovery.ifStaleFailure = "publish_failed";

    const result = await setup.subject.execute(executionInput(setup.fileStore));

    expectResultError(result, {
      code: "discovery_failed",
      partialSetupPublicIdentity: setup.keys.nextPublicIdentity,
    });
    expect(setup.local.saveCalls).toBe(0);
    expect(setup.keys.disposedKeys).toHaveLength(1);
  });

  it.each(["encrypt", "drive-write", "signup", "discovery", "local-save"] as const)(
    "disposes the key once and zeroes exported bytes when %s throws",
    async (stage) => {
      const setup = createSetup();
      if (stage === "encrypt") {
        setup.crypto.throwOnEncrypt = true;
      } else if (stage === "drive-write") {
        setup.fileStore.createPassportFile = async () => { throw new Error("Drive write threw"); };
      } else if (stage === "signup") {
        setup.sessionAccess.signup = async () => { throw new Error("signup threw"); };
      } else if (stage === "discovery") {
        setup.discovery.publishHomeserverIfStale = async () => { throw new Error("discovery threw"); };
      } else {
        setup.local.throwOnSave = true;
      }

      await expect(setup.subject.execute(executionInput(setup.fileStore))).rejects.toThrow();

      expect(setup.keys.disposedKeys).toHaveLength(1);
      expect(setup.crypto.encryptedInputIsZeroed()).toBe(true);
    },
  );

  it("preserves a successful outcome when key cleanup throws", async () => {
    const setup = createSetup();
    setup.keys.disposeIdentityKey = () => { throw new Error("cleanup failed"); };

    const result = await setup.subject.execute(executionInput(setup.fileStore));

    expectResultOk(result);
  });
});

function createSetup(input: {
  fileStore?: SanitizedPassportFileStore;
  local?: RecordingSaveLocalIdentity;
} = {}) {
  const keys = new RecordingPubkyIdentityKeys();
  const sessionAccess = new RecordingPubkySessionAccess();
  sessionAccess.session.publicIdentity = keys.nextPublicIdentity;
  const discovery = new RecordingPubkyDiscovery();
  const local = input.local ?? new RecordingSaveLocalIdentity();
  const crypto = new RecordingPassportFileCrypto();
  const fileStore = input.fileStore ?? new SanitizedPassportFileStore({ status: "missing" });
  const subject = new CreateGoogleBackedIdentity({
    crypto,
    identityKeys: keys,
    sessionAccess,
    discovery,
    localIdentities: local,
    passportOrigin: "https://passport.pubky.app",
  });
  return { subject, keys, sessionAccess, discovery, local, crypto, fileStore };
}

function executionInput(fileStore: SanitizedPassportFileStore) {
  return {
    invitation: TEST_SIGNUP_INVITATION,
    passportFileStore: fileStore,
    wrappingKey: "w".repeat(43),
  };
}
