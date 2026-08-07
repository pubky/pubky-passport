/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
  TEST_PASSPORT_ENVELOPE,
  TEST_PASSPORT_REFERENCE,
  TEST_SIGNUP_INVITATION,
} from "../../../../test-utils/fakes/googleBackedIdentityTestDoubles";
import { expectResultError, expectResultOk } from "../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../libs/logger/logger";
import type { ReportGoogleBackedIdentityProgress } from "./googleBackedIdentityProgress";

const PUBLIC_IDENTITY = {
  publicKeyZ32: "public-identity",
  publicKeyDisplay: "pubkypublic-identity",
};
const NOOP_PROGRESS: ReportGoogleBackedIdentityProgress = () => {};

const MOCKS = vi.hoisted(() => {
  const state = {
    wrappingResult: null as unknown,
    readResult: null as unknown,
    homegateResult: null as unknown,
    restoreResult: null as unknown,
    createResult: null as unknown,
    throwStage: null as "restore" | "create" | "homegate" | null,
    wrappingCalls: 0,
    wrappingReceivedToken: false,
    readCalls: 0,
    restoreCalls: 0,
    restoreReceivedExpectedInput: false,
    createCalls: 0,
    createReceivedExpectedInput: false,
    homegateCalls: 0,
    homegateReceivedToken: false,
    deleteReceivedExpectedInput: false,
    events: [] as string[],
    operationalDriveAccessTokenProvider: null as (() => Promise<string>) | null,
    visibleDriveAccessTokenProvider: null as (() => Promise<string>) | null,
    operationalDriveFetch: null as typeof fetch | null,
    visibleDriveUsesOperationalFetch: false,
    createdExpectedEnvelope: false,
    visibleWriterReceivedExpectedEnvelope: false,
    visibleWriterReceivedAbortSignal: false,
    visibleWriterReceivedPublicKey: false,
  };

  return {
    state,
    PubkySdkAdapter: vi.fn(),
    pubky: {
      createIdentityKey: vi.fn(),
      restoreIdentityKey: vi.fn(),
      disposeIdentityKey: vi.fn(),
      exportSecretKey: vi.fn(),
      getPublicIdentity: vi.fn(),
      signup: vi.fn(),
      signin: vi.fn(),
      publishHomeserverIfStale: vi.fn(),
      dispose: vi.fn(),
    },
    PassportFileWebCrypto: vi.fn(),
    passportFileCrypto: {
      encryptSecretKeyBytes() {},
      decryptSecretKeyBytes() {},
    },
    GoogleDrivePassportFileStore: vi.fn(),
    passportFileStore: {
      async readPassportFile() {
        state.readCalls += 1;
        return state.readResult;
      },
      async createPassportFile(envelope: unknown) {
        state.createdExpectedEnvelope = envelope === TEST_PASSPORT_ENVELOPE;
        return Result.ok();
      },
      async deletePassportFile() {
        return Result.ok({ status: "deleted" as const });
      },
    },
    GoogleDriveVisibleRecoveryCopyWriter: vi.fn(),
    visibleRecoveryCopyWriter: {
      async createVisibleRecoveryCopy(envelope: unknown, publicKeyDisplay: unknown, signal: unknown) {
        state.visibleWriterReceivedExpectedEnvelope = envelope === TEST_PASSPORT_ENVELOPE;
        state.visibleWriterReceivedPublicKey = publicKeyDisplay === PUBLIC_IDENTITY.publicKeyDisplay;
        state.visibleWriterReceivedAbortSignal = signal instanceof AbortSignal;
        return Result.ok();
      },
    },
    SaveLocalIdentity: vi.fn(),
    saveLocalIdentity: {},
    CreateGoogleBackedIdentity: vi.fn(),
    createMissingIdentity: {
      async execute(
        invitation: unknown,
        createPassportFile: unknown,
        createVisibleRecoveryCopy: unknown,
        wrappingKey: string,
        reportProgress: ReportGoogleBackedIdentityProgress,
      ) {
        state.events.push("create");
        state.createCalls += 1;
        state.createReceivedExpectedInput = invitation === TEST_SIGNUP_INVITATION
          && typeof createPassportFile === "function"
          && typeof createVisibleRecoveryCopy === "function"
          && wrappingKey.length === 43;
        if (state.throwStage === "create") throw new Error("create secret");
        if (typeof createPassportFile === "function" && typeof createVisibleRecoveryCopy === "function") {
          reportProgress("storing_encrypted_identity");
          await createPassportFile(TEST_PASSPORT_ENVELOPE);
          await createVisibleRecoveryCopy(
            TEST_PASSPORT_ENVELOPE,
            PUBLIC_IDENTITY.publicKeyDisplay,
            new AbortController().signal,
          );
        }
        reportProgress("signing_up_to_homeserver");
        reportProgress("publishing_discovery");
        reportProgress("activating_created_identity");
        return state.createResult;
      },
    },
    DeleteGoogleIdentityBackups: vi.fn(),
    identityBackupDeleter: {
      async deleteGoogleIdentityBackups(
        credentials: { googleIdToken: string; driveAccessToken: string },
        publicIdentity: { publicKeyZ32: string },
      ) {
        state.deleteReceivedExpectedInput = credentials.googleIdToken.length > 0
          && credentials.driveAccessToken.length > 0
          && publicIdentity.publicKeyZ32 === "public-key";
        return Result.ok();
      },
    },
    RestoreGoogleBackedIdentity: vi.fn(),
    restoreExistingIdentity: {
      async execute(
        envelope: unknown,
        wrappingKey: string,
        reportProgress: ReportGoogleBackedIdentityProgress,
      ) {
        state.restoreCalls += 1;
        state.restoreReceivedExpectedInput = envelope === TEST_PASSPORT_ENVELOPE
          && wrappingKey.length === 43;
        if (state.throwStage === "restore") throw new Error("restore secret");
        reportProgress("restoring_identity");
        reportProgress("activating_restored_identity");
        return state.restoreResult;
      },
    },
    HomegateClient: vi.fn(),
    homegateClient: {
      async requestGoogleHomeserverSignupInvitation(googleIdToken: string) {
        state.events.push("homegate");
        state.homegateCalls += 1;
        state.homegateReceivedToken = googleIdToken.trim().length > 0;
        if (state.throwStage === "homegate") throw new Error("Homegate secret");
        return state.homegateResult;
      },
    },
    WrappingKeyApiClient: vi.fn(),
    wrappingKeyApiClient: {
      async requestGoogleWrappingKey(googleIdToken: string) {
        state.wrappingCalls += 1;
        state.wrappingReceivedToken = googleIdToken.trim().length > 0;
        return state.wrappingResult;
      },
    },
  };
});

vi.mock("../../pubky/pubkySdkAdapter", () => ({
  PubkySdkAdapter: MOCKS.PubkySdkAdapter,
}));

vi.mock("../../passport-file/passportFileWebCrypto", () => ({
  PassportFileWebCrypto: MOCKS.PassportFileWebCrypto,
}));

vi.mock("../../passport-file/googleDrivePassportFileStore", () => ({
  GoogleDrivePassportFileStore: MOCKS.GoogleDrivePassportFileStore,
}));

vi.mock("../../passport-file/googleDriveVisibleRecoveryCopyWriter", () => ({
  GoogleDriveVisibleRecoveryCopyWriter: MOCKS.GoogleDriveVisibleRecoveryCopyWriter,
}));

vi.mock("../local/saveLocalIdentity", () => ({
  SaveLocalIdentity: MOCKS.SaveLocalIdentity,
}));

vi.mock("./createGoogleBackedIdentity", () => ({
  CreateGoogleBackedIdentity: MOCKS.CreateGoogleBackedIdentity,
}));

vi.mock("./deleteGoogleIdentityBackups", () => ({
  DeleteGoogleIdentityBackups: MOCKS.DeleteGoogleIdentityBackups,
}));

vi.mock("./restoreGoogleBackedIdentity", () => ({
  RestoreGoogleBackedIdentity: MOCKS.RestoreGoogleBackedIdentity,
}));

vi.mock("../../homegate/homegateClient", () => ({
  HomegateClient: MOCKS.HomegateClient,
}));

vi.mock("../../wrapping-key/wrappingKeyApiClient", () => ({
  WrappingKeyApiClient: MOCKS.WrappingKeyApiClient,
}));

import { GoogleBackedIdentityOperations } from "./googleBackedIdentityOperations";

describe("GoogleBackedIdentityOperations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wires dependencies, restores a found identity, delegates deletion, and disposes once", async () => {
    prepareConstructors();
    const saveIdentityRecord = sanitizedSaveIdentityRecord();
    const operations = createOperations(saveIdentityRecord);
    const progress: string[] = [];

    expect(MOCKS.HomegateClient).toHaveBeenCalledWith({
      homegateBaseUrl: "https://homegate.example/api/",
    });
    expect(MOCKS.SaveLocalIdentity).toHaveBeenCalledWith(saveIdentityRecord, MOCKS.pubky);
    expect(MOCKS.RestoreGoogleBackedIdentity).toHaveBeenCalledWith({
      decryptSecretKeyBytes: expect.any(Function),
      pubky: MOCKS.pubky,
      saveLocalIdentity: MOCKS.saveLocalIdentity,
      passportOrigin: "https://passport.example",
    });
    expect(MOCKS.CreateGoogleBackedIdentity).toHaveBeenCalledWith({
      encryptSecretKeyBytes: expect.any(Function),
      pubky: MOCKS.pubky,
      saveLocalIdentity: MOCKS.saveLocalIdentity,
      passportOrigin: "https://passport.example",
    });

    expectResultOk(await operations.restoreOrCreateGoogleBackedIdentity(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      (phase) => progress.push(phase),
    ));
    await operations.deleteGoogleIdentityBackups(TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS, {
      publicKeyZ32: "public-key",
      publicKeyDisplay: PUBLIC_IDENTITY.publicKeyDisplay,
    }, TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS.googleAccount.id);

    expect(MOCKS.state.restoreCalls).toBe(1);
    expect(MOCKS.state.restoreReceivedExpectedInput).toBe(true);
    expect(MOCKS.state.createCalls).toBe(0);
    expect(MOCKS.state.homegateCalls).toBe(0);
    expect(MOCKS.state.deleteReceivedExpectedInput).toBe(true);
    expect(progress).toEqual([
      "preparing_secure_identity",
      "checking_passport_file",
      "restoring_identity",
      "activating_restored_identity",
    ]);

    operations.dispose();
    operations.dispose();
    expect(MOCKS.pubky.dispose).toHaveBeenCalledOnce();
  });

  it("requests Homegate before creating an identity when the Drive file is missing", async () => {
    prepareConstructors({ fileStatus: "missing" });
    const operations = createOperations();
    const progress: string[] = [];

    expectResultOk(await operations.restoreOrCreateGoogleBackedIdentity(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      (phase) => progress.push(phase),
    ));

    expect(MOCKS.state.homegateCalls).toBe(1);
    expect(MOCKS.state.homegateReceivedToken).toBe(true);
    expect(MOCKS.state.createCalls).toBe(1);
    expect(MOCKS.state.createReceivedExpectedInput).toBe(true);
    expect(MOCKS.state.createdExpectedEnvelope).toBe(true);
    expect(MOCKS.state.visibleWriterReceivedExpectedEnvelope).toBe(true);
    expect(MOCKS.state.visibleWriterReceivedAbortSignal).toBe(true);
    expect(MOCKS.state.visibleWriterReceivedPublicKey).toBe(true);
    expect(MOCKS.state.restoreCalls).toBe(0);
    expect(MOCKS.state.events).toEqual(["homegate", "create"]);
    expect(progress).toEqual([
      "preparing_secure_identity",
      "checking_passport_file",
      "preparing_new_identity",
      "creating_identity",
      "storing_encrypted_identity",
      "signing_up_to_homeserver",
      "publishing_discovery",
      "activating_created_identity",
    ]);
    await expect(MOCKS.state.operationalDriveAccessTokenProvider?.()).resolves.toBe(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS.driveAccessToken,
    );
    await expect(MOCKS.state.visibleDriveAccessTokenProvider?.()).resolves.toBe(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS.driveAccessToken,
    );
    expect(MOCKS.state.visibleDriveUsesOperationalFetch).toBe(true);
  });

  it("stops before creation when Homegate fails", async () => {
    prepareConstructors({ fileStatus: "missing", homegateFailure: true });
    const operations = createOperations();
    const progress: string[] = [];

    expectResultError(
      await operations.restoreOrCreateGoogleBackedIdentity(
        TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
        (phase) => progress.push(phase),
      ),
      { code: "homeserver_signup_invitation_failed", cause: "homegate_unavailable" },
    );
    expect(MOCKS.state.createCalls).toBe(0);
    expect(progress).toEqual([
      "preparing_secure_identity",
      "checking_passport_file",
      "preparing_new_identity",
    ]);
  });

  it("maps wrapping-key and Drive read failures", async () => {
    prepareConstructors({ wrappingFailure: true });
    const wrappingProgress: string[] = [];
    expectResultError(
      await createOperations().restoreOrCreateGoogleBackedIdentity(
        TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
        (phase) => wrappingProgress.push(phase),
      ),
      { code: "wrapping_key_failed", cause: "network_failed" },
    );
    expect(wrappingProgress).toEqual(["preparing_secure_identity"]);

    prepareConstructors({ readFailure: true });
    const readProgress: string[] = [];
    expectResultError(
      await createOperations().restoreOrCreateGoogleBackedIdentity(
        TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
        (phase) => readProgress.push(phase),
      ),
      { code: "drive_read_failed" },
    );
    expect(readProgress).toEqual(["preparing_secure_identity", "checking_passport_file"]);
  });

  it("contains progress listener failures without interrupting establishment", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    prepareConstructors();

    expectResultOk(await createOperations().restoreOrCreateGoogleBackedIdentity(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
      () => { throw new Error("SECRET-PROGRESS-LISTENER"); },
    ));

    expect(warning).toHaveBeenCalledWith("identity.google.progress_listener.failed");
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-PROGRESS-LISTENER");
  });

  it.each(["restore", "create", "homegate"] as const)(
    "maps an unexpected %s exception without exposing dependency details",
    async (stage) => {
      prepareConstructors({
        fileStatus: stage === "restore" ? "found" : "missing",
        throwStage: stage,
      });

      expectResultError(
        await createOperations().restoreOrCreateGoogleBackedIdentity(
          TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
          NOOP_PROGRESS,
        ),
        { code: "unexpected_failure" },
      );
    },
  );

  it("disposes Pubky when construction fails", () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    prepareConstructors();
    MOCKS.CreateGoogleBackedIdentity.mockImplementationOnce(function () {
      throw new Error("construction failed");
    });
    MOCKS.pubky.dispose.mockImplementationOnce(() => {
      throw new Error("dispose failed");
    });

    expect(() => createOperations()).toThrow("construction failed");
    expect(MOCKS.pubky.dispose).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("identity.google.cleanup.failed", {
      operation: "construction_pubky_dispose",
    });
  });
});

function prepareConstructors(input: {
  fileStatus?: "found" | "missing";
  wrappingFailure?: boolean;
  readFailure?: boolean;
  homegateFailure?: boolean;
  throwStage?: "restore" | "create" | "homegate";
} = {}): void {
  vi.clearAllMocks();
  Object.assign(MOCKS.state, {
    wrappingResult: input.wrappingFailure
      ? Result.err({ code: "network_failed" as const })
      : Result.ok("w".repeat(43)),
    readResult: input.readFailure
      ? Result.err({ code: "network_failed" as const })
      : input.fileStatus === "missing"
        ? Result.ok({ status: "missing" as const })
        : Result.ok({
            status: "found" as const,
            envelope: TEST_PASSPORT_ENVELOPE,
            reference: TEST_PASSPORT_REFERENCE,
          }),
    homegateResult: input.homegateFailure
      ? Result.err({ code: "homegate_unavailable" as const })
      : Result.ok(TEST_SIGNUP_INVITATION),
    restoreResult: Result.ok({ establishmentMode: "restored" as const, publicIdentity: PUBLIC_IDENTITY }),
    createResult: Result.ok({
      establishmentMode: "created" as const,
      publicIdentity: PUBLIC_IDENTITY,
      visibleRecoveryCopyStatus: "created" as const,
    }),
    throwStage: input.throwStage ?? null,
    wrappingCalls: 0,
    wrappingReceivedToken: false,
    readCalls: 0,
    restoreCalls: 0,
    restoreReceivedExpectedInput: false,
    createCalls: 0,
    createReceivedExpectedInput: false,
    homegateCalls: 0,
    homegateReceivedToken: false,
    deleteReceivedExpectedInput: false,
    events: [],
    operationalDriveAccessTokenProvider: null,
    visibleDriveAccessTokenProvider: null,
    operationalDriveFetch: null,
    visibleDriveUsesOperationalFetch: false,
    createdExpectedEnvelope: false,
    visibleWriterReceivedExpectedEnvelope: false,
    visibleWriterReceivedAbortSignal: false,
    visibleWriterReceivedPublicKey: false,
  });
  MOCKS.PubkySdkAdapter.mockImplementation(function () {
    return MOCKS.pubky;
  });
  MOCKS.PassportFileWebCrypto.mockImplementation(function () {
    return MOCKS.passportFileCrypto;
  });
  MOCKS.GoogleDrivePassportFileStore.mockImplementation(function (input: {
    accessTokenProvider: () => Promise<string>;
    fetch: typeof fetch;
  }) {
    MOCKS.state.operationalDriveAccessTokenProvider = input.accessTokenProvider;
    MOCKS.state.operationalDriveFetch = input.fetch;
    return MOCKS.passportFileStore;
  });
  MOCKS.GoogleDriveVisibleRecoveryCopyWriter.mockImplementation(function (input: {
    accessTokenProvider: () => Promise<string>;
    fetch: typeof fetch;
  }) {
    MOCKS.state.visibleDriveAccessTokenProvider = input.accessTokenProvider;
    MOCKS.state.visibleDriveUsesOperationalFetch = input.fetch === MOCKS.state.operationalDriveFetch;
    return MOCKS.visibleRecoveryCopyWriter;
  });
  MOCKS.SaveLocalIdentity.mockImplementation(function () {
    return MOCKS.saveLocalIdentity;
  });
  MOCKS.WrappingKeyApiClient.mockImplementation(function () {
    return MOCKS.wrappingKeyApiClient;
  });
  MOCKS.HomegateClient.mockImplementation(function () {
    return MOCKS.homegateClient;
  });
  MOCKS.RestoreGoogleBackedIdentity.mockImplementation(function () {
    return MOCKS.restoreExistingIdentity;
  });
  MOCKS.CreateGoogleBackedIdentity.mockImplementation(function () {
    return MOCKS.createMissingIdentity;
  });
  MOCKS.DeleteGoogleIdentityBackups.mockImplementation(function () {
    return MOCKS.identityBackupDeleter;
  });
}

function createOperations(
  saveIdentityRecord = sanitizedSaveIdentityRecord(),
): GoogleBackedIdentityOperations {
  return new GoogleBackedIdentityOperations({
    saveIdentityRecord,
    homegateBaseUrl: "https://homegate.example/api/",
    passportOrigin: "https://passport.example",
  });
}

function sanitizedSaveIdentityRecord() {
  return () => Result.err({ code: "storage_unavailable" as const });
}
