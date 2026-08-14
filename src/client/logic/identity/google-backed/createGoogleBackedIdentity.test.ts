import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecordingPubkySdkAdapter } from "../../../../../test-utils/fakes/recordingPubkySdkAdapter";
import {
  TEST_SIGNUP_INVITATION,
  RecordingSaveLocalIdentity,
  RecordingPassportFileCrypto,
  RecordingPassportFileOperations,
} from "../../../../../test-utils/fakes/googleBackedIdentityTestDoubles";
import { expectResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../../libs/logger/logger";
import { ActivateGoogleBackedIdentity } from "./activateGoogleBackedIdentity";
import { CreateGoogleBackedIdentity } from "./createGoogleBackedIdentity";

describe("CreateGoogleBackedIdentity", () => {
  afterEach(() => vi.restoreAllMocks());
  it("encrypts, stores, activates, and saves a new identity in order", async () => {
    const events: string[] = [];
    const setup = createSetup({
      fileStore: new RecordingPassportFileOperations(
        { status: "missing" },
        () => events.push("drive-create"),
        () => events.push("visible-copy"),
      ),
      local: new RecordingSaveLocalIdentity(() => events.push("save")),
    });
    const signup = vi.spyOn(setup.pubky, "signup");
    signup.mockImplementationOnce(async (input) => {
      events.push("signup");
      signup.mockRestore();
      return setup.pubky.signup(input);
    });
    const publish = vi.spyOn(setup.pubky, "publishHomeserverIfStale");
    publish.mockImplementationOnce(async (input) => {
      events.push("discovery");
      publish.mockRestore();
      return setup.pubky.publishHomeserverIfStale(input);
    });

    const result = await setup.subject.execute(
      ...executionInput(setup.fileStore, (progress) => events.push(progress)),
    );

    expect(expectResultOk(result)).toEqual({
      establishmentMode: "created",
      publicIdentity: setup.pubky.nextPublicIdentity,
      visibleRecoveryCopyStatus: "created",
    });
    expect(setup.pubky.createCalls).toBe(1);
    expect(setup.fileStore.createdFiles).toEqual([{
      version: 1,
      url: "https://passport.pubky.app",
      ivCharacters: 16,
      ciphertextCharacters: 64,
    }]);
    expect(setup.fileStore.visibleRecoveryCopyPublicKeys).toEqual([
      setup.pubky.nextPublicIdentity.publicKeyDisplay,
    ]);
    expect(setup.local.saveCalls).toBe(1);
    expect(setup.pubky.signupCalls).toHaveLength(1);
    expect(setup.pubky.signupCalls[0]).toMatchObject({
      homeserverPubky: "homegate-homeserver",
      hasSignupCode: true,
    });
    expect(setup.pubky.discoveryCalls).toEqual([{ hasHomeserverPubky: true }]);
    expect(events).toEqual([
      "storing_encrypted_identity",
      "drive-create",
      "visible-copy",
      "signing_up_to_homeserver",
      "signup",
      "publishing_discovery",
      "discovery",
      "activating_created_identity",
      "save",
    ]);
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
      if (Result.isError(result)) expect(result.error.preservedPassportFileIdentity).toBeUndefined();
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
      preservedPassportFileIdentity: setup.pubky.nextPublicIdentity,
    });
    expect(setup.pubky.discoveryCalls).toEqual([]);
    expect(setup.local.saveCalls).toBe(0);
    expect(setup.pubky.disposedKeys).toHaveLength(1);
  });

  it("activates the identity and reports a warning when only the visible recovery copy fails", async () => {
    const setup = createSetup();
    setup.fileStore.visibleRecoveryCopyFailure = "forbidden";

    const result = await setup.subject.execute(...executionInput(setup.fileStore));

    expect(expectResultOk(result)).toEqual({
      establishmentMode: "created",
      publicIdentity: setup.pubky.nextPublicIdentity,
      visibleRecoveryCopyStatus: "unconfirmed",
    });
    expect(setup.pubky.signupCalls).toHaveLength(1);
    expect(setup.pubky.discoveryCalls).toHaveLength(1);
    expect(setup.local.saveCalls).toBe(1);
    expect(setup.pubky.disposedKeys).toHaveLength(1);
  });

  it("aborts a stalled visible copy and continues identity activation after the deadline", async () => {
    const setup = createSetup({ visibleRecoveryCopyTimeoutMs: 5 });
    let aborted = false;
    const stalledVisibleCopy = (
      _envelope: unknown,
      _publicKeyDisplay: string,
      signal: AbortSignal,
    ) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });

    const result = await setup.subject.execute(
      TEST_SIGNUP_INVITATION,
      (envelope) => setup.fileStore.createPassportFile("drive-token", envelope),
      stalledVisibleCopy,
      "w".repeat(43),
      () => { },
    );

    expect(expectResultOk(result)).toMatchObject({
      establishmentMode: "created",
      visibleRecoveryCopyStatus: "unconfirmed",
    });
    expect(aborted).toBe(true);
    expect(setup.pubky.signupCalls).toHaveLength(1);
    expect(setup.pubky.discoveryCalls).toHaveLength(1);
    expect(setup.local.saveCalls).toBe(1);
  });

  it("preserves the visible-copy warning when later activation fails", async () => {
    const setup = createSetup();
    setup.fileStore.visibleRecoveryCopyFailure = "forbidden";
    setup.pubky.signupFailure = "signup_failed";

    const result = await setup.subject.execute(...executionInput(setup.fileStore));

    expectResultError(result, {
      code: "signup_failed",
      preservedPassportFileIdentity: setup.pubky.nextPublicIdentity,
      warning: "visible_recovery_copy_unconfirmed",
    });
  });

  it("logs one business warning while continuing after the writer owns a visible-copy failure", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const setup = createSetup();
    setup.fileStore.visibleRecoveryCopyFailure = "forbidden";

    expectResultOk(await setup.subject.execute(...executionInput(setup.fileStore)));

    expect(warning).toHaveBeenCalledWith("identity.google.visible_recovery_copy.unconfirmed", {
      activationContinues: true,
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("drive-token");
    expect(JSON.stringify(warning.mock.calls)).not.toContain("opaque-file-id");
  });

  it("logs balanced successful creation milestones without sensitive values", async () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    const setup = createSetup();

    expectResultOk(await setup.subject.execute(...executionInput(setup.fileStore)));

    const events = info.mock.calls.map(([event]) => event);
    expect(events).toEqual(expect.arrayContaining([
      "identity.google.create.started",
      "identity.google.create_key.started",
      "identity.google.create_key.completed",
      "identity.google.encrypt.started",
      "identity.google.encrypt.completed",
      "identity.google.operational_drive_write.started",
      "identity.google.operational_drive_write.completed",
      "identity.google.visible_recovery_copy.started",
      "identity.google.visible_recovery_copy.completed",
      "identity.google.signup.started",
      "identity.google.signup.completed",
      "identity.google.discovery.started",
      "identity.google.discovery.completed",
      "identity.google.create.completed",
    ]));
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain("drive-token");
    expect(logged).not.toContain("w".repeat(43));
    expect(logged).not.toContain("homegate-signup-code");
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
      preservedPassportFileIdentity: setup.pubky.nextPublicIdentity,
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
      preservedPassportFileIdentity: setup.pubky.nextPublicIdentity,
    });
    expect(setup.local.saveCalls).toBe(0);
    expect(setup.pubky.disposedKeys).toHaveLength(1);
  });

  it.each(["encrypt", "drive-write"] as const)(
    "disposes the key once and zeroes exported bytes when %s throws",
    async (stage) => {
      const setup = createSetup();
      if (stage === "encrypt") {
        setup.crypto.throwOnEncrypt = true;
      } else {
        setup.fileStore.createPassportFile = async () => { throw new Error("Drive write threw"); };
      }

      await expect(setup.subject.execute(...executionInput(setup.fileStore))).rejects.toThrow();

      expect(setup.pubky.disposedKeys).toHaveLength(1);
      expect(setup.crypto.encryptedInputIsZeroed()).toBe(true);
    },
  );

  it.each(["signup", "discovery", "local-save"] as const)(
    "preserves the identity and visible-copy warning when %s unexpectedly throws",
    async (stage) => {
      const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
      const setup = createSetup();
      setup.fileStore.visibleRecoveryCopyFailure = "forbidden";
      if (stage === "signup") setup.pubky.throwOnSignup = true;
      else if (stage === "discovery") setup.pubky.throwOnDiscovery = true;
      else setup.local.throwOnSave = true;

      const result = await setup.subject.execute(...executionInput(setup.fileStore));

      expectResultError(result, {
        code: "unexpected_failure",
        preservedPassportFileIdentity: setup.pubky.nextPublicIdentity,
        warning: "visible_recovery_copy_unconfirmed",
      });
      expect(setup.pubky.disposedKeys).toHaveLength(1);
      expect(setup.crypto.encryptedInputIsZeroed()).toBe(true);
      expect(warning).toHaveBeenCalledWith("identity.google.activation.failed", {
        code: "unexpected_failure",
      });
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
  visibleRecoveryCopyTimeoutMs?: number;
} = {}) {
  const pubky = new RecordingPubkySdkAdapter();
  pubky.session.publicIdentity = pubky.nextPublicIdentity;
  const local = input.local ?? new RecordingSaveLocalIdentity();
  const crypto = new RecordingPassportFileCrypto();
  const fileStore = input.fileStore ?? new RecordingPassportFileOperations({ status: "missing" });
  const activation = new ActivateGoogleBackedIdentity({
    pubky,
    saveIdentityLocally: local.saveIdentity,
  });
  const subject = new CreateGoogleBackedIdentity({
    encryptSecretKeyBytes: (encryptInput) => crypto.encryptSecretKeyBytes(encryptInput),
    pubky,
    activateIdentity: (...activationInput) => activation.execute(...activationInput),
    passportOrigin: "https://passport.pubky.app",
    ...(input.visibleRecoveryCopyTimeoutMs === undefined
      ? {}
      : { visibleRecoveryCopyTimeoutMs: input.visibleRecoveryCopyTimeoutMs }),
  });
  return { subject, pubky, local, crypto, fileStore };
}

function executionInput(
  fileStore: RecordingPassportFileOperations,
  reportProgress: Parameters<CreateGoogleBackedIdentity["execute"]>[4] = () => { },
) {
  return [
    TEST_SIGNUP_INVITATION,
    (envelope: Parameters<RecordingPassportFileOperations["createPassportFile"]>[1]) => fileStore.createPassportFile("drive-token", envelope),
    (
      envelope: Parameters<RecordingPassportFileOperations["createVisibleRecoveryCopy"]>[1],
      publicKeyDisplay: string,
      signal: AbortSignal,
    ) => fileStore.createVisibleRecoveryCopy("drive-token", envelope, publicKeyDisplay, signal),
    "w".repeat(43),
    reportProgress,
  ] as const;
}
