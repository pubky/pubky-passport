/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../test-utils/fakes/memoryStorage";
import type { GoogleSignInResult } from "./google-sign-in/application/googleSignIn";

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
  GoogleIdentityServicesDriveAccessRequester: vi.fn(),
  mountGoogleSignIn: vi.fn(),
  unmountGoogleSignIn: vi.fn(),
  credentialCallback: null as CredentialCallback | null,
}));

vi.mock("./google-backed-identity/composition/googleBackedIdentityOperations", () => ({
  GoogleBackedIdentityOperations: MOCKS.GoogleBackedIdentityOperations,
}));

vi.mock("./google-sign-in/adapters/googleIdentityServicesSignInButton", () => ({
  GoogleIdentityServicesSignInButton: MOCKS.GoogleIdentityServicesSignInButton,
}));

vi.mock("./google-drive-access/adapters/googleIdentityServicesDriveAccessRequester", () => ({
  GoogleIdentityServicesDriveAccessRequester: MOCKS.GoogleIdentityServicesDriveAccessRequester,
}));

import { createBrowserIdentityController } from "./createBrowserIdentityController";

const VALID_CONTROLLER_CONFIG = {
  googleClientId: "google-client-id",
  homegateBaseUrl: "https://homegate.example/",
};

describe("createBrowserIdentityController", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    MOCKS.GoogleBackedIdentityOperations.mockReset();
    MOCKS.disposeGoogleBackedIdentityOperations.mockReset();
    MOCKS.establishCalls = 0;
    MOCKS.establishReceivedExpectedCredentials = false;
    MOCKS.deleteCalls = 0;
    MOCKS.deleteReceivedExpectedInput = false;
    MOCKS.GoogleIdentityServicesSignInButton.mockReset();
    MOCKS.GoogleIdentityServicesDriveAccessRequester.mockReset();
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
    MOCKS.GoogleIdentityServicesSignInButton.mockImplementation(function () {
      return {
        mount: MOCKS.mountGoogleSignIn,
        unmount: MOCKS.unmountGoogleSignIn,
      };
    });
    MOCKS.GoogleIdentityServicesDriveAccessRequester.mockImplementation(function () {
      return { async request() { return Result.ok("drive-access-token"); } };
    });
    MOCKS.mountGoogleSignIn.mockImplementation(async (input: {
      onCredential: CredentialCallback;
    }) => {
      MOCKS.credentialCallback = input.onCredential;
      return Result.ok();
    });
    MOCKS.establishImplementation = async () => Result.ok({
      establishmentMode: "restored",
      publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("serves the local identity catalog without constructing the Pubky action graph", () => {
    const controller = createBrowserIdentityController(VALID_CONTROLLER_CONFIG);

    const identities = controller.list();
    expect(Result.isError(identities)).toBe(false);
    if (Result.isError(identities)) throw new Error(identities.error.code);
    expect(identities.value).toEqual({ activeIdentityId: null, identities: [] });
    expect(MOCKS.GoogleBackedIdentityOperations).not.toHaveBeenCalled();

    controller.dispose();
    expect(MOCKS.GoogleBackedIdentityOperations).not.toHaveBeenCalled();
  });

  it("constructs one action graph and delegates establish and delete", async () => {
    const controller = createBrowserIdentityController(VALID_CONTROLLER_CONFIG);
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
      keyStore: expect.anything(),
      homegateBaseUrl: "https://homegate.example/",
      passportOrigin: window.location.origin,
    });
    expect(MOCKS.establishCalls).toBe(1);
    expect(MOCKS.establishReceivedExpectedCredentials).toBe(true);

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
    const controller = createBrowserIdentityController(VALID_CONTROLLER_CONFIG);
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
    const controller = createBrowserIdentityController(VALID_CONTROLLER_CONFIG);
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
    const controller = createBrowserIdentityController(VALID_CONTROLLER_CONFIG);
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
  controller: ReturnType<typeof createBrowserIdentityController>,
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
