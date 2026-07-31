/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../test-utils/fakes/memoryStorage";
import { LOGGER } from "../../libs/logger/logger";
import type { GoogleSignInResult } from "../google-sign-in/googleIdentityServicesSignInButton";

type CredentialCallback = (
  result: GoogleSignInResult<{ googleIdToken: string; subject: string }>,
) => void;

const MOCKS = vi.hoisted(() => ({
  GoogleBackedIdentityOperations: vi.fn(),
  disposeGoogleBackedIdentityOperations: vi.fn(),
  establishCalls: 0,
  establishReceivedExpectedCredentials: false,
  establishImplementation: null as null | (() => Promise<unknown>),
  deleteCalls: 0,
  deleteReceivedExpectedInput: false,
  GoogleIdentityServicesSignInButton: vi.fn(),
  GoogleDriveAccess: vi.fn(),
  signInGoogleIdentityServices: null as unknown,
  driveAccessCalls: 0,
  driveAccessReceivedExpectedInput: false,
  mountGoogleSignIn: vi.fn(),
  unmountGoogleSignIn: vi.fn(),
  credentialCallback: null as CredentialCallback | null,
}));

vi.mock("./google-backed-identity/googleBackedIdentityOperations", () => ({
  GoogleBackedIdentityOperations: MOCKS.GoogleBackedIdentityOperations,
}));

vi.mock("../google-sign-in/googleIdentityServicesSignInButton", () => ({
  GoogleIdentityServicesSignInButton: MOCKS.GoogleIdentityServicesSignInButton,
}));

vi.mock("../google-drive-access/googleDriveAccess", () => ({
  GoogleDriveAccess: MOCKS.GoogleDriveAccess,
}));

import { createPassportIdentityController } from "./passportIdentity";

const VALID_CONTROLLER_CONFIG = {
  googleClientId: "google-client-id",
  homegateBaseUrl: "https://homegate.example/",
};

function createController() {
  return createPassportIdentityController(VALID_CONTROLLER_CONFIG);
}

describe("createPassportIdentityController", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    MOCKS.GoogleBackedIdentityOperations.mockReset();
    MOCKS.disposeGoogleBackedIdentityOperations.mockReset();
    MOCKS.establishCalls = 0;
    MOCKS.establishReceivedExpectedCredentials = false;
    MOCKS.deleteCalls = 0;
    MOCKS.deleteReceivedExpectedInput = false;
    MOCKS.GoogleIdentityServicesSignInButton.mockReset();
    MOCKS.GoogleDriveAccess.mockReset();
    MOCKS.signInGoogleIdentityServices = null;
    MOCKS.driveAccessCalls = 0;
    MOCKS.driveAccessReceivedExpectedInput = false;
    MOCKS.mountGoogleSignIn.mockReset();
    MOCKS.unmountGoogleSignIn.mockReset();
    MOCKS.credentialCallback = null;

    MOCKS.GoogleBackedIdentityOperations.mockImplementation(function () {
      return {
        async establishGoogleBackedIdentity(credentials: { googleIdToken: string; driveAccessToken: string }) {
          MOCKS.establishCalls += 1;
          MOCKS.establishReceivedExpectedCredentials = credentials.googleIdToken.length > 0
            && credentials.driveAccessToken.length > 0;
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
          return Result.ok();
        },
        dispose: MOCKS.disposeGoogleBackedIdentityOperations,
      };
    });
    MOCKS.GoogleIdentityServicesSignInButton.mockImplementation(function (options: {
      googleIdentityServices: unknown;
    }) {
      MOCKS.signInGoogleIdentityServices = options.googleIdentityServices;
      return {
        mount: MOCKS.mountGoogleSignIn,
        unmount: MOCKS.unmountGoogleSignIn,
      };
    });
    MOCKS.GoogleDriveAccess.mockImplementation(function (options: {
      clientId: string;
      fetch: typeof fetch;
      googleIdentityServices: unknown;
    }) {
      return {
        async requestAccessToken(input: {
          expectedSubject: string;
          signal: AbortSignal;
        }) {
          MOCKS.driveAccessCalls += 1;
          MOCKS.driveAccessReceivedExpectedInput = options.clientId === "google-client-id"
            && typeof options.fetch === "function"
            && options.googleIdentityServices === MOCKS.signInGoogleIdentityServices
            && input.expectedSubject === "google-subject"
            && input.signal instanceof AbortSignal;
          return Result.ok("drive-access-token");
        },
      };
    });
    MOCKS.mountGoogleSignIn.mockImplementation(async (
      _target: HTMLElement,
      onCredential: CredentialCallback,
    ) => {
      MOCKS.credentialCallback = onCredential;
      return Result.ok();
    });
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
    MOCKS.GoogleIdentityServicesSignInButton.mockImplementationOnce(() => {
      throw new Error("SECRET-CONFIGURATION-VALUE");
    });

    expect(() => createController()).toThrow("SECRET-CONFIGURATION-VALUE");
    expect(error).toHaveBeenCalledWith("identity.controller.failed", {
      operation: "initialize",
      code: "runtime_exception",
    });
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET-CONFIGURATION-VALUE");
    expect(JSON.stringify(error.mock.calls)).not.toContain(VALID_CONTROLLER_CONFIG.homegateBaseUrl);
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
    expect(MOCKS.driveAccessCalls).toBe(1);
    expect(MOCKS.driveAccessReceivedExpectedInput).toBe(true);

    emitGoogleCredential();
    await expect(controller.continueGoogleBackedIdentityAction({
      kind: "delete_google_drive_passport_file",
      expectedPublicKeyZ32: "public-key",
    })).resolves.toEqual({
      status: "action_completed",
      result: Result.ok({ kind: "google_drive_passport_file_deleted" }),
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
      result: Result.ok({ kind: "google_drive_passport_file_deleted" }),
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

    emitGoogleCredential();
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
  await controller.mountGoogleSignIn(document.createElement("div"), vi.fn());
  emitGoogleCredential();
}

function emitGoogleCredential(): void {
  MOCKS.credentialCallback?.(Result.ok({
    googleIdToken: "google-id-token",
    subject: "google-subject",
  }));
}

function establishedIdentity() {
  return Result.ok({
    establishmentMode: "restored" as const,
    publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
  });
}
