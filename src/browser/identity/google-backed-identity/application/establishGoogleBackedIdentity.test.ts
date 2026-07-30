import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { HomegateClient } from "../../../homegate/homegateClient";
import {
  TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
  TEST_PASSPORT_ENVELOPE,
  TEST_PASSPORT_REFERENCE,
  TEST_SIGNUP_INVITATION,
  RecordingPassportFileCrypto,
  RecordingSaveLocalIdentity,
  RecordingPassportFileOperations,
} from "../../../../../test-utils/fakes/googleBackedIdentityTestDoubles";
import { expectResultError, expectResultOk } from "../../../../../test-utils/resultAssertions";
import type { GoogleBackedIdentity, GoogleBackedIdentityResult } from "./googleBackedIdentity";
import { CreateGoogleBackedIdentity } from "./createGoogleBackedIdentity";
import { EstablishGoogleBackedIdentity } from "./establishGoogleBackedIdentity";
import { RestoreGoogleBackedIdentity } from "./restoreGoogleBackedIdentity";
import { RecordingPubkySdkAdapter } from "../../../../../test-utils/fakes/recordingPubkySdkAdapter";

const PUBLIC_IDENTITY = {
  publicKeyZ32: "public-identity",
  publicKeyDisplay: "pubkypublic-identity",
};

describe("EstablishGoogleBackedIdentity", () => {
  it("routes a found Drive Passport file to restoration without requesting Homegate", async () => {
    const fileStore = new RecordingPassportFileOperations({
      status: "found",
      envelope: TEST_PASSPORT_ENVELOPE,
      reference: TEST_PASSPORT_REFERENCE,
    });
    const restoreExistingIdentity = createRecordingRestoreGoogleBackedIdentity();
    const createMissingIdentity = createRecordingCreateGoogleBackedIdentity();
    const homegate = createSanitizedHomegateClient();
    const subject = createSubject({
      fileStore,
      restoreExistingIdentity,
      createMissingIdentity,
      homegate: homegate.client,
    });

    const result = await subject.establish(TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS);

    expectResultOk(result);
    expect(restoreExistingIdentity.calls).toBe(1);
    expect(restoreExistingIdentity.receivedExpectedInput).toBe(true);
    expect(createMissingIdentity.calls).toBe(0);
    expect(homegate.calls).toEqual({ count: 0, hasGoogleIdToken: false });
  });

  it("requests Homegate before routing a missing Drive Passport file to creation", async () => {
    const events: string[] = [];
    const fileStore = new RecordingPassportFileOperations({ status: "missing" });
    const homegate = createSanitizedHomegateClient(async () => {
      events.push("homegate");
      return Result.ok(TEST_SIGNUP_INVITATION);
    });
    const createMissingIdentity = createRecordingCreateGoogleBackedIdentity(async () => {
      events.push("create");
      return Result.ok({ establishmentMode: "created", publicIdentity: PUBLIC_IDENTITY });
    });
    const subject = createSubject({ fileStore, createMissingIdentity, homegate: homegate.client });

    const result = await subject.establish(TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS);

    expectResultOk(result);
    expect(homegate.calls).toEqual({ count: 1, hasGoogleIdToken: true });
    expect(JSON.stringify(homegate)).not.toContain(TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS.googleIdToken);
    expect(createMissingIdentity.calls).toBe(1);
    expect(createMissingIdentity.receivedExpectedInput).toBe(true);
    expect(events).toEqual(["homegate", "create"]);
  });

  it("stops before creation when Homegate fails", async () => {
    const homegate = createSanitizedHomegateClient(async () => Result.err({ code: "homegate_unavailable" as const }));
    const createMissingIdentity = createRecordingCreateGoogleBackedIdentity();
    const subject = createSubject({
      fileStore: new RecordingPassportFileOperations({ status: "missing" }),
      createMissingIdentity,
      homegate: homegate.client,
    });

    const result = await subject.establish(TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS);

    expectResultError(result, {
      code: "homeserver_signup_invitation_failed",
      cause: "homegate_unavailable",
    });
    expect(createMissingIdentity.calls).toBe(0);
  });

  it("maps wrapping-key and Drive read failures at the coordinator boundary", async () => {
    const wrappingFailure = createSubject({ wrappingFailure: true });
    expectResultError(await wrappingFailure.establish(TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS), {
      code: "wrapping_key_failed",
      cause: "network_failed",
    });

    const readFailure = createSubject({
      fileStore: new RecordingPassportFileOperations({ code: "network_failed" }),
    });
    expectResultError(await readFailure.establish(TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS), {
      code: "drive_read_failed",
    });
  });

  it.each(["restore", "create", "homegate"] as const)(
    "maps an unexpected %s exception without exposing dependency details",
    async (stage) => {
      const fileStore = new RecordingPassportFileOperations(stage === "restore"
        ? { status: "found", envelope: TEST_PASSPORT_ENVELOPE, reference: TEST_PASSPORT_REFERENCE }
        : { status: "missing" });
      const restoreExistingIdentity = createRecordingRestoreGoogleBackedIdentity(async () => { throw new Error("restore secret"); });
      const createMissingIdentity = createRecordingCreateGoogleBackedIdentity(async () => { throw new Error("create secret"); });
      const homegate = stage === "homegate"
        ? createSanitizedHomegateClient(async () => { throw new Error("Homegate secret"); })
        : createSanitizedHomegateClient();
      const subject = createSubject({
        fileStore,
        restoreExistingIdentity,
        createMissingIdentity,
        homegate: homegate.client,
      });

      const result = await subject.establish(TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS);

      expectResultError(result, { code: "unexpected_failure" });
    },
  );
});

function createSubject(input: {
  fileStore?: RecordingPassportFileOperations;
  restoreExistingIdentity?: RecordingRestoreGoogleBackedIdentity;
  createMissingIdentity?: RecordingCreateGoogleBackedIdentity;
  homegate?: HomegateClient;
  wrappingFailure?: boolean;
} = {}): EstablishGoogleBackedIdentity {
  const fileStore = input.fileStore ?? new RecordingPassportFileOperations({ status: "missing" });
  const wrappingKeyRequest = sanitizedWrappingKeyRequest(input.wrappingFailure === true);

  return new EstablishGoogleBackedIdentity({
    requestWrappingKey: wrappingKeyRequest.request,
    readPassportFile: fileStore.readPassportFile.bind(fileStore),
    createPassportFile: fileStore.createPassportFile.bind(fileStore),
    homegate: input.homegate ?? createSanitizedHomegateClient().client,
    restoreExistingIdentity: input.restoreExistingIdentity ?? createRecordingRestoreGoogleBackedIdentity(),
    createMissingIdentity: input.createMissingIdentity ?? createRecordingCreateGoogleBackedIdentity(),
  });
}

function sanitizedWrappingKeyRequest(fails: boolean) {
  const calls = { count: 0, hasGoogleIdToken: false };
  return {
    calls,
    async request(googleIdToken: string) {
      calls.count += 1;
      calls.hasGoogleIdToken = googleIdToken.trim().length > 0;
      return fails
        ? Result.err({ code: "network_failed" as const })
        : Result.ok("w".repeat(43));
    },
  };
}

function createSanitizedHomegateClient(
  implementation: () => ReturnType<HomegateClient["requestGoogleHomeserverSignupInvitation"]> = async () => Result.ok(TEST_SIGNUP_INVITATION),
) {
  const calls = { count: 0, hasGoogleIdToken: false };
  const client = new HomegateClient({
    homegateBaseUrl: "https://homegate.example/",
    fetch: async () => { throw new Error("Unexpected Homegate fetch."); },
  });
  client.requestGoogleHomeserverSignupInvitation = async (googleIdToken: string) => {
    calls.count += 1;
    calls.hasGoogleIdToken = googleIdToken.trim().length > 0;
    return implementation();
  };
  return { calls, client };
}

function createRecordingRestoreGoogleBackedIdentity(
  implementation = async () => Result.ok({ establishmentMode: "restored" as const, publicIdentity: PUBLIC_IDENTITY }),
): RecordingRestoreGoogleBackedIdentity {
  return new RecordingRestoreGoogleBackedIdentity(implementation);
}

function createRecordingCreateGoogleBackedIdentity(
  implementation = async () => Result.ok({ establishmentMode: "created" as const, publicIdentity: PUBLIC_IDENTITY }),
): RecordingCreateGoogleBackedIdentity {
  return new RecordingCreateGoogleBackedIdentity(implementation);
}

type IdentityImplementation = () => Promise<GoogleBackedIdentityResult<GoogleBackedIdentity>>;

class RecordingRestoreGoogleBackedIdentity extends RestoreGoogleBackedIdentity {
  calls = 0;
  receivedExpectedInput = false;
  readonly #implementation: IdentityImplementation;

  constructor(implementation: IdentityImplementation) {
    super(restoreDependencies());
    this.#implementation = implementation;
  }

  override async execute(
    envelope: Parameters<RestoreGoogleBackedIdentity["execute"]>[0],
    wrappingKey: Parameters<RestoreGoogleBackedIdentity["execute"]>[1],
  ) {
    this.calls += 1;
    this.receivedExpectedInput = envelope === TEST_PASSPORT_ENVELOPE && wrappingKey.length === 43;
    return this.#implementation();
  }
}

class RecordingCreateGoogleBackedIdentity extends CreateGoogleBackedIdentity {
  calls = 0;
  receivedExpectedInput = false;
  readonly #implementation: IdentityImplementation;

  constructor(implementation: IdentityImplementation) {
    super(createDependencies());
    this.#implementation = implementation;
  }

  override async execute(
    invitation: Parameters<CreateGoogleBackedIdentity["execute"]>[0],
    createPassportFile: Parameters<CreateGoogleBackedIdentity["execute"]>[1],
    wrappingKey: Parameters<CreateGoogleBackedIdentity["execute"]>[2],
  ) {
    this.calls += 1;
    this.receivedExpectedInput = invitation === TEST_SIGNUP_INVITATION
      && wrappingKey.length === 43
      && typeof createPassportFile === "function";
    return this.#implementation();
  }
}

function restoreDependencies(): ConstructorParameters<typeof RestoreGoogleBackedIdentity>[0] {
  const pubky = new RecordingPubkySdkAdapter();
  const crypto = new RecordingPassportFileCrypto();
  return {
    decryptSecretKeyBytes: crypto.decryptSecretKeyBytes.bind(crypto),
    pubky,
    localIdentities: new RecordingSaveLocalIdentity(),
    passportOrigin: "https://passport.pubky.app",
  };
}

function createDependencies(): ConstructorParameters<typeof CreateGoogleBackedIdentity>[0] {
  const pubky = new RecordingPubkySdkAdapter();
  const crypto = new RecordingPassportFileCrypto();
  return {
    encryptSecretKeyBytes: crypto.encryptSecretKeyBytes.bind(crypto),
    pubky,
    localIdentities: new RecordingSaveLocalIdentity(),
    passportOrigin: "https://passport.pubky.app",
  };
}
