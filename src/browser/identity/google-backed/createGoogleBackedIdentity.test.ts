import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { RecordingPubkySdkAdapter } from "../../../../test-utils/fakes/recordingPubkySdkAdapter";
import {
  TEST_SIGNUP_INVITATION,
  RecordingSaveLocalIdentity,
  RecordingPassportFileCrypto,
  RecordingPassportFileOperations,
} from "../../../../test-utils/fakes/googleBackedIdentityTestDoubles";
import { expectResultError, expectResultOk } from "../../../../test-utils/resultAssertions";
import { CreateGoogleBackedIdentity } from "./createGoogleBackedIdentity";

describe("CreateGoogleBackedIdentity", () => {
  it("encrypts, stores, activates, and saves a new identity in order", async () => {
    const events: string[] = [];
    const setup = createSetup({
      fileStore: new RecordingPassportFileOperations({ status: "missing" }, () => events.push("drive-create")),
      local: new RecordingSaveLocalIdentity(() => events.push("save")),
    });
    const signup = setup.pubky.signup.bind(setup.pubky);
    setup.pubky.signup = async (input) => {
      events.push("signup");
      return signup(input);
    };
    const publish = setup.pubky.publishHomeserverIfStale.bind(setup.pubky);
    setup.pubky.publishHomeserverIfStale = async (input) => {
      events.push("discovery");
      return publish(input);
    };

    const result = await setup.subject.execute(...executionInput(setup.fileStore));

    expectResultOk(result);
    expect(setup.pubky.createCalls).toBe(1);
    expect(setup.fileStore.createdFiles).toEqual([{
      version: 1,
      url: "https://passport.pubky.app",
      ivCharacters: 16,
      ciphertextCharacters: 64,
    }]);
    expect(setup.local.saveCalls).toBe(1);
    expect(setup.pubky.signupCalls).toHaveLength(1);
    expect(setup.pubky.signupCalls[0]).toMatchObject({
      homeserverPubky: "homegate-homeserver",
      hasSignupCode: true,
    });
    expect(setup.pubky.discoveryCalls).toEqual([{ hasHomeserverPubky: true }]);
    expect(events).toEqual(["drive-create", "signup", "discovery", "save"]);
    expect(setup.crypto.encryptedInputIsZeroed()).toBe(true);
    expect(setup.pubky.disposedKeys).toHaveLength(1);
  });

  it("maps a Drive create conflict and disposes the unpersisted key", async () => {
    const setup = createSetup();
    setup.fileStore.createFailure = "create_conflict";

    const result = await setup.subject.execute(...executionInput(setup.fileStore));

    expectResultError(result, { code: "drive_create_conflict" });
    expect(setup.pubky.disposedKeys).toHaveLength(1);
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

      const result = await setup.subject.execute(...executionInput(setup.fileStore));

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) expect(result.error.partialSetupPublicIdentity).toBeUndefined();
      expect(setup.pubky.disposedKeys).toHaveLength(1);
      expect(setup.crypto.encryptedInputIsZeroed()).toBe(true);
    },
  );

  it("returns a recoverable identity when signup fails after Drive creation", async () => {
    const setup = createSetup();
    setup.pubky.signupFailure = "signup_failed";

    const result = await setup.subject.execute(...executionInput(setup.fileStore));

    expectResultError(result, {
      code: "signup_failed",
      partialSetupPublicIdentity: setup.pubky.nextPublicIdentity,
    });
    expect(setup.pubky.discoveryCalls).toEqual([]);
    expect(setup.local.saveCalls).toBe(0);
    expect(setup.pubky.disposedKeys).toHaveLength(1);
  });

  it("rejects a signup session for a different identity before discovery or local save", async () => {
    const setup = createSetup();
    setup.pubky.session.publicIdentity = {
      publicKeyZ32: "different-session-identity",
      publicKeyDisplay: "pubkydifferent-session-identity",
    };

    const result = await setup.subject.execute(...executionInput(setup.fileStore));

    expectResultError(result, {
      code: "identity_mismatch",
      partialSetupPublicIdentity: setup.pubky.nextPublicIdentity,
    });
    expect(setup.pubky.discoveryCalls).toEqual([]);
    expect(setup.local.saveCalls).toBe(0);
  });

  it("does not save locally when discovery publication fails", async () => {
    const setup = createSetup();
    setup.pubky.discoveryFailure = "publish_failed";

    const result = await setup.subject.execute(...executionInput(setup.fileStore));

    expectResultError(result, {
      code: "discovery_failed",
      partialSetupPublicIdentity: setup.pubky.nextPublicIdentity,
    });
    expect(setup.local.saveCalls).toBe(0);
    expect(setup.pubky.disposedKeys).toHaveLength(1);
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
        setup.pubky.throwOnSignup = true;
      } else if (stage === "discovery") {
        setup.pubky.throwOnDiscovery = true;
      } else {
        setup.local.throwOnSave = true;
      }

      await expect(setup.subject.execute(...executionInput(setup.fileStore))).rejects.toThrow();

      expect(setup.pubky.disposedKeys).toHaveLength(1);
      expect(setup.crypto.encryptedInputIsZeroed()).toBe(true);
    },
  );

  it("preserves a successful outcome when key cleanup throws", async () => {
    const setup = createSetup();
    setup.pubky.throwOnDisposeIdentity = true;

    const result = await setup.subject.execute(...executionInput(setup.fileStore));

    expectResultOk(result);
  });
});

function createSetup(input: {
  fileStore?: RecordingPassportFileOperations;
  local?: RecordingSaveLocalIdentity;
} = {}) {
  const pubky = new RecordingPubkySdkAdapter();
  pubky.session.publicIdentity = pubky.nextPublicIdentity;
  const local = input.local ?? new RecordingSaveLocalIdentity();
  const crypto = new RecordingPassportFileCrypto();
  const fileStore = input.fileStore ?? new RecordingPassportFileOperations({ status: "missing" });
  const subject = new CreateGoogleBackedIdentity({
    encryptSecretKeyBytes: crypto.encryptSecretKeyBytes.bind(crypto),
    pubky,
    saveLocalIdentity: local,
    passportOrigin: "https://passport.pubky.app",
  });
  return { subject, pubky, local, crypto, fileStore };
}

function executionInput(fileStore: RecordingPassportFileOperations) {
  return [
    TEST_SIGNUP_INVITATION,
    (envelope: Parameters<RecordingPassportFileOperations["createPassportFile"]>[1]) => fileStore.createPassportFile("drive-token", envelope),
    "w".repeat(43),
  ] as const;
}
