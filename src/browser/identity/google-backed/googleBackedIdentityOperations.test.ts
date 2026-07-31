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

const PUBLIC_IDENTITY = {
  publicKeyZ32: "public-identity",
  publicKeyDisplay: "pubkypublic-identity",
};

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
    driveAccessTokenProvider: null as (() => Promise<string>) | null,
    createdExpectedEnvelope: false,
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
        return Result.ok(TEST_PASSPORT_REFERENCE);
      },
      async deletePassportFile() {
        return Result.ok();
      },
    },
    SaveLocalIdentity: vi.fn(),
    saveLocalIdentity: {},
    CreateGoogleBackedIdentity: vi.fn(),
    createMissingIdentity: {
      async execute(invitation: unknown, createPassportFile: unknown, wrappingKey: string) {
        state.events.push("create");
        state.createCalls += 1;
        state.createReceivedExpectedInput = invitation === TEST_SIGNUP_INVITATION
          && typeof createPassportFile === "function"
          && wrappingKey.length === 43;
        if (state.throwStage === "create") throw new Error("create secret");
        if (typeof createPassportFile === "function") {
          await createPassportFile(TEST_PASSPORT_ENVELOPE);
        }
        return state.createResult;
      },
    },
    DeleteGoogleDrivePassportFile: vi.fn(),
    passportFileDeleter: {
      async deleteGoogleDrivePassportFile(
        credentials: { googleIdToken: string; driveAccessToken: string },
        expectedPublicKeyZ32: string,
      ) {
        state.deleteReceivedExpectedInput = credentials.googleIdToken.length > 0
          && credentials.driveAccessToken.length > 0
          && expectedPublicKeyZ32 === "public-key";
        return Result.ok();
      },
    },
    RestoreGoogleBackedIdentity: vi.fn(),
    restoreExistingIdentity: {
      async execute(envelope: unknown, wrappingKey: string) {
        state.restoreCalls += 1;
        state.restoreReceivedExpectedInput = envelope === TEST_PASSPORT_ENVELOPE
          && wrappingKey.length === 43;
        if (state.throwStage === "restore") throw new Error("restore secret");
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

vi.mock("../local/saveLocalIdentity", () => ({
  SaveLocalIdentity: MOCKS.SaveLocalIdentity,
}));

vi.mock("./createGoogleBackedIdentity", () => ({
  CreateGoogleBackedIdentity: MOCKS.CreateGoogleBackedIdentity,
}));

vi.mock("./deleteGoogleDrivePassportFile", () => ({
  DeleteGoogleDrivePassportFile: MOCKS.DeleteGoogleDrivePassportFile,
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
    ));
    await operations.deleteGoogleDrivePassportFile(TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS, "public-key");

    expect(MOCKS.state.restoreCalls).toBe(1);
    expect(MOCKS.state.restoreReceivedExpectedInput).toBe(true);
    expect(MOCKS.state.createCalls).toBe(0);
    expect(MOCKS.state.homegateCalls).toBe(0);
    expect(MOCKS.state.deleteReceivedExpectedInput).toBe(true);

    operations.dispose();
    operations.dispose();
    expect(MOCKS.pubky.dispose).toHaveBeenCalledOnce();
  });

  it("requests Homegate before creating an identity when the Drive file is missing", async () => {
    prepareConstructors({ fileStatus: "missing" });
    const operations = createOperations();

    expectResultOk(await operations.restoreOrCreateGoogleBackedIdentity(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS,
    ));

    expect(MOCKS.state.homegateCalls).toBe(1);
    expect(MOCKS.state.homegateReceivedToken).toBe(true);
    expect(MOCKS.state.createCalls).toBe(1);
    expect(MOCKS.state.createReceivedExpectedInput).toBe(true);
    expect(MOCKS.state.createdExpectedEnvelope).toBe(true);
    expect(MOCKS.state.restoreCalls).toBe(0);
    expect(MOCKS.state.events).toEqual(["homegate", "create"]);
    await expect(MOCKS.state.driveAccessTokenProvider?.()).resolves.toBe(
      TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS.driveAccessToken,
    );
  });

  it("stops before creation when Homegate fails", async () => {
    prepareConstructors({ fileStatus: "missing", homegateFailure: true });
    const operations = createOperations();

    expectResultError(
      await operations.restoreOrCreateGoogleBackedIdentity(TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS),
      { code: "homeserver_signup_invitation_failed", cause: "homegate_unavailable" },
    );
    expect(MOCKS.state.createCalls).toBe(0);
  });

  it("maps wrapping-key and Drive read failures", async () => {
    prepareConstructors({ wrappingFailure: true });
    expectResultError(
      await createOperations().restoreOrCreateGoogleBackedIdentity(TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS),
      { code: "wrapping_key_failed", cause: "network_failed" },
    );

    prepareConstructors({ readFailure: true });
    expectResultError(
      await createOperations().restoreOrCreateGoogleBackedIdentity(TEST_GOOGLE_BACKED_IDENTITY_CREDENTIALS),
      { code: "drive_read_failed" },
    );
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
    createResult: Result.ok({ establishmentMode: "created" as const, publicIdentity: PUBLIC_IDENTITY }),
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
    driveAccessTokenProvider: null,
    createdExpectedEnvelope: false,
  });
  MOCKS.PubkySdkAdapter.mockImplementation(function () {
    return MOCKS.pubky;
  });
  MOCKS.PassportFileWebCrypto.mockImplementation(function () {
    return MOCKS.passportFileCrypto;
  });
  MOCKS.GoogleDrivePassportFileStore.mockImplementation(function (input: {
    accessTokenProvider: () => Promise<string>;
  }) {
    MOCKS.state.driveAccessTokenProvider = input.accessTokenProvider;
    return MOCKS.passportFileStore;
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
  MOCKS.DeleteGoogleDrivePassportFile.mockImplementation(function () {
    return MOCKS.passportFileDeleter;
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
