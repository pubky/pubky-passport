/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../test-utils/fakes/memoryStorage";
import { LOGGER } from "../../libs/logger/logger";
const MOCKS = vi.hoisted(() => ({
  GoogleBackedIdentityOperations: vi.fn(),
  disposeGoogleBackedIdentityOperations: vi.fn(),
  establishCalls: 0,
  establishReceivedExpectedCredentials: false,
  establishProgress: [] as string[],
  establishImplementation: null as null | (() => Promise<unknown>),
  deleteCalls: 0,
  deleteReceivedExpectedInput: false,
  GoogleAuthorizationCode: vi.fn(),
  prepareGoogleAuthorization: vi.fn(),
  requestGoogleAuthorization: vi.fn(),
  disposeGoogleAuthorization: vi.fn(),
}));

vi.mock("./google-backed/googleBackedIdentityOperations", () => ({
  GoogleBackedIdentityOperations: MOCKS.GoogleBackedIdentityOperations,
}));

vi.mock("../google-authorization/googleAuthorizationCode", () => ({
  GoogleAuthorizationCode: MOCKS.GoogleAuthorizationCode,
}));

import { createPassportIdentityController } from "./passportIdentity";

const GOOGLE_CLIENT_ID = "google-client-id";
const HOMEGATE_BASE_URL = "https://homegate.example/";

function createController() {
  return createPassportIdentityController(GOOGLE_CLIENT_ID, HOMEGATE_BASE_URL);
}

describe("createPassportIdentityController", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    MOCKS.GoogleBackedIdentityOperations.mockReset();
    MOCKS.disposeGoogleBackedIdentityOperations.mockReset();
    MOCKS.establishCalls = 0;
    MOCKS.establishReceivedExpectedCredentials = false;
    MOCKS.establishProgress = [];
    MOCKS.deleteCalls = 0;
    MOCKS.deleteReceivedExpectedInput = false;
    MOCKS.GoogleAuthorizationCode.mockReset();
    MOCKS.prepareGoogleAuthorization.mockReset();
    MOCKS.requestGoogleAuthorization.mockReset();
    MOCKS.disposeGoogleAuthorization.mockReset();

    MOCKS.GoogleBackedIdentityOperations.mockImplementation(function () {
      return {
        async restoreOrCreateGoogleBackedIdentity(
          credentials: { googleIdToken: string; driveAccessToken: string },
          reportProgress: (progress: "checking_passport_file" | "restoring_identity") => void,
        ) {
          MOCKS.establishCalls += 1;
          MOCKS.establishReceivedExpectedCredentials = credentials.googleIdToken.length > 0
            && credentials.driveAccessToken.length > 0;
          reportProgress("checking_passport_file");
          reportProgress("restoring_identity");
          MOCKS.establishProgress.push("checking_passport_file", "restoring_identity");
          return MOCKS.establishImplementation?.();
        },
        async deleteGoogleDrivePassportFile(
          credentials: { googleIdToken: string; driveAccessToken: string },
          expectedPublicKeyZ32: string,
        ) {
          MOCKS.deleteCalls += 1;
          MOCKS.deleteReceivedExpectedInput = credentials.googleIdToken.length > 0
            && credentials.driveAccessToken.length > 0
            && expectedPublicKeyZ32 === "public-key";
          return Result.ok({ status: "deleted" as const });
        },
        dispose: MOCKS.disposeGoogleBackedIdentityOperations,
      };
    });
    MOCKS.GoogleAuthorizationCode.mockImplementation(function () {
      return {
        prepare: MOCKS.prepareGoogleAuthorization,
        request: MOCKS.requestGoogleAuthorization,
        dispose: MOCKS.disposeGoogleAuthorization,
      };
    });
    MOCKS.prepareGoogleAuthorization.mockResolvedValue(Result.ok());
    MOCKS.requestGoogleAuthorization.mockResolvedValue(Result.ok({ googleIdToken: "google-id-token", driveAccessToken: "drive-access-token" }));
    MOCKS.establishImplementation = async () => Result.ok({
      establishmentMode: "restored",
      publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("logs construction failures without configuration or exception details", () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    MOCKS.GoogleAuthorizationCode.mockImplementationOnce(() => {
      throw new Error("SECRET-CONFIGURATION-VALUE");
    });

    expect(() => createController()).toThrow("SECRET-CONFIGURATION-VALUE");
    expect(error).toHaveBeenCalledWith("identity.controller.failed", {
      operation: "initialize",
      code: "runtime_exception",
    });
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-CONFIGURATION-VALUE");
    expect(JSON.stringify(error.mock.calls)).not.toContain(HOMEGATE_BASE_URL);
  });

  it("serves the local identity catalog without constructing the Pubky action graph", () => {
    const controller = createController();

    const identities = controller.list();
    expect(Result.isError(identities)).toBe(false);
    if (Result.isError(identities)) throw new Error(identities.error.code);
    expect(identities.value).toEqual({ activeIdentityId: null, identities: [] });
    expect(MOCKS.GoogleBackedIdentityOperations).not.toHaveBeenCalled();

    controller.dispose();
    expect(MOCKS.GoogleBackedIdentityOperations).not.toHaveBeenCalled();
  });

  it("constructs one action graph and delegates establish and delete", async () => {
    const controller = createController();
    await mountWithGoogleCredential(controller);

    await expect(controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" })).resolves.toEqual({
      status: "action_completed",
      result: Result.ok({
        kind: "google_backed_identity_established",
        establishmentMode: "restored",
        publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
      }),
    });
    expect(MOCKS.GoogleBackedIdentityOperations).toHaveBeenCalledWith({
      saveIdentityRecord: expect.any(Function),
      homegateBaseUrl: "https://homegate.example/",
      passportOrigin: window.location.origin,
    });
    expect(MOCKS.establishCalls).toBe(1);
    expect(MOCKS.establishReceivedExpectedCredentials).toBe(true);
    expect(MOCKS.establishProgress).toEqual(["checking_passport_file", "restoring_identity"]);
    await expect(controller.continueGoogleBackedIdentityAction({
      kind: "delete_google_drive_passport_file",
      expectedPublicKeyZ32: "public-key",
    })).resolves.toEqual({
      status: "action_completed",
      result: Result.ok({ kind: "google_drive_passport_file_deleted", deletionStatus: "deleted" }),
    });
    expect(MOCKS.GoogleBackedIdentityOperations).toHaveBeenCalledOnce();
    expect(MOCKS.deleteCalls).toBe(1);
    expect(MOCKS.deleteReceivedExpectedInput).toBe(true);

    controller.dispose();
    controller.dispose();
    expect(MOCKS.disposeGoogleBackedIdentityOperations).toHaveBeenCalledOnce();
  });

  it("constructs the action graph when delete is the first action", async () => {
    const controller = createController();
    await mountWithGoogleCredential(controller);

    await expect(controller.continueGoogleBackedIdentityAction({
      kind: "delete_google_drive_passport_file",
      expectedPublicKeyZ32: "public-key",
    })).resolves.toEqual({
      status: "action_completed",
      result: Result.ok({ kind: "google_drive_passport_file_deleted", deletionStatus: "deleted" }),
    });
    expect(MOCKS.GoogleBackedIdentityOperations).toHaveBeenCalledOnce();
    expect(MOCKS.deleteCalls).toBe(1);
    expect(MOCKS.deleteReceivedExpectedInput).toBe(true);

    controller.dispose();
    expect(MOCKS.disposeGoogleBackedIdentityOperations).toHaveBeenCalledOnce();
  });

  it("rolls back a partially constructed action graph before retrying", async () => {
    MOCKS.GoogleBackedIdentityOperations.mockImplementationOnce(function () {
      throw new Error("construction failed");
    });
    const controller = createController();
    await mountWithGoogleCredential(controller);

    const failed = await controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" });
    expect(failed.status).toBe("action_completed");
    if (failed.status !== "action_completed") throw new Error("Expected completed action");
    expect(Result.isError(failed.result)).toBe(true);
    if (!Result.isError(failed.result)) throw new Error("Expected construction failure");
    expect(failed.result.error).toEqual({ code: "unexpected_failure" });
    expect(MOCKS.GoogleBackedIdentityOperations).toHaveBeenCalledOnce();
    expect(MOCKS.disposeGoogleBackedIdentityOperations).not.toHaveBeenCalled();

    await expect(controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" })).resolves.toMatchObject({
      status: "action_completed",
      result: { value: { kind: "google_backed_identity_established" } },
    });
    expect(MOCKS.GoogleBackedIdentityOperations).toHaveBeenCalledTimes(2);

    controller.dispose();
    expect(MOCKS.disposeGoogleBackedIdentityOperations).toHaveBeenCalledOnce();
  });

  it("defers action graph disposal until an in-flight action settles", async () => {
    let resolveEstablish!: (result: ReturnType<typeof establishedIdentity>) => void;
    MOCKS.establishImplementation = () => new Promise((resolve) => {
      resolveEstablish = resolve;
    });
    const controller = createController();
    await mountWithGoogleCredential(controller);

    const pending = controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" });
    await vi.waitFor(() => expect(MOCKS.establishCalls).toBe(1));
    controller.dispose();
    expect(MOCKS.disposeGoogleBackedIdentityOperations).not.toHaveBeenCalled();

    resolveEstablish(establishedIdentity());
    await expect(pending).resolves.toMatchObject({ status: "action_finished_after_unmount" });
    expect(MOCKS.disposeGoogleBackedIdentityOperations).toHaveBeenCalledOnce();
  });
});

async function mountWithGoogleCredential(
  controller: ReturnType<typeof createPassportIdentityController>,
): Promise<void> {
  await controller.prepareGoogleAuthorization(vi.fn());
}

function establishedIdentity() {
  return Result.ok({
    establishmentMode: "restored" as const,
    publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
  });
}
