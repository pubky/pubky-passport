/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../test-utils/fakes/memoryStorage";
import type { GoogleSignInResult } from "./google-sign-in/application/googleSignIn";

type CredentialCallback = (
  result: GoogleSignInResult<{ googleIdToken: string; subject: string }>,
) => void;

const MOCKS = vi.hoisted(() => ({
  GoogleIdentityActions: vi.fn(),
  disposeIdentityActions: vi.fn(),
  establish: vi.fn(),
  deleteIdentity: vi.fn(),
  GoogleIdentityServicesSignInButton: vi.fn(),
  GoogleIdentityServicesDriveAccessRequester: vi.fn(),
  mountGoogleSignIn: vi.fn(),
  unmountGoogleSignIn: vi.fn(),
  requestGoogleDriveAccess: vi.fn(),
  credentialCallback: null as CredentialCallback | null,
}));

vi.mock("./google-backed-identity/composition/googleIdentityActions", () => ({
  GoogleIdentityActions: MOCKS.GoogleIdentityActions,
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
    MOCKS.GoogleIdentityActions.mockReset();
    MOCKS.disposeIdentityActions.mockReset();
    MOCKS.establish.mockReset();
    MOCKS.deleteIdentity.mockReset();
    MOCKS.GoogleIdentityServicesSignInButton.mockReset();
    MOCKS.GoogleIdentityServicesDriveAccessRequester.mockReset();
    MOCKS.mountGoogleSignIn.mockReset();
    MOCKS.unmountGoogleSignIn.mockReset();
    MOCKS.requestGoogleDriveAccess.mockReset();
    MOCKS.credentialCallback = null;

    MOCKS.GoogleIdentityActions.mockImplementation(function () {
      return {
        establish: MOCKS.establish,
        deleteDriveIdentity: MOCKS.deleteIdentity,
        dispose: MOCKS.disposeIdentityActions,
      };
    });
    MOCKS.GoogleIdentityServicesSignInButton.mockImplementation(function () {
      return {
        mount: MOCKS.mountGoogleSignIn,
        unmount: MOCKS.unmountGoogleSignIn,
      };
    });
    MOCKS.GoogleIdentityServicesDriveAccessRequester.mockImplementation(function () {
      return { request: MOCKS.requestGoogleDriveAccess };
    });
    MOCKS.mountGoogleSignIn.mockImplementation(async (input: {
      onCredential: CredentialCallback;
    }) => {
      MOCKS.credentialCallback = input.onCredential;
      return Result.ok();
    });
    MOCKS.requestGoogleDriveAccess.mockResolvedValue(Result.ok("drive-access-token"));
    MOCKS.establish.mockResolvedValue(Result.ok({
      source: "restored",
      publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
    }));
    MOCKS.deleteIdentity.mockResolvedValue(Result.ok());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("serves the local identity catalog without constructing the Pubky action graph", () => {
    const controller = createBrowserIdentityController(VALID_CONTROLLER_CONFIG);

    const identities = controller.list();
    expect(Result.isError(identities)).toBe(false);
    if (Result.isError(identities)) throw new Error(identities.error.code);
    expect(identities.value).toEqual({ activeIdentityId: null, identities: [] });
    expect(MOCKS.GoogleIdentityActions).not.toHaveBeenCalled();

    controller.dispose();
    expect(MOCKS.GoogleIdentityActions).not.toHaveBeenCalled();
  });

  it("constructs one action graph and delegates establish and delete", async () => {
    const controller = createBrowserIdentityController(VALID_CONTROLLER_CONFIG);
    await mountWithGoogleCredential(controller);

    await expect(controller.continueGoogle({ kind: "establish" })).resolves.toEqual({
      status: "action_completed",
      result: Result.ok({
        kind: "established",
        source: "restored",
        publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
      }),
    });
    expect(MOCKS.GoogleIdentityActions).toHaveBeenCalledWith({
      keyStore: expect.anything(),
      homegateBaseUrl: "https://homegate.example/",
      passportOrigin: window.location.origin,
    });
    expect(MOCKS.establish).toHaveBeenCalledWith({
      googleIdToken: "google-id-token",
      driveAccessToken: "drive-access-token",
    });

    emitGoogleCredential();
    await expect(controller.continueGoogle({
      kind: "delete",
      expectedPublicKeyZ32: "public-key",
    })).resolves.toEqual({
      status: "action_completed",
      result: Result.ok({ kind: "deleted" }),
    });
    expect(MOCKS.GoogleIdentityActions).toHaveBeenCalledOnce();
    expect(MOCKS.deleteIdentity).toHaveBeenCalledWith(
      { googleIdToken: "google-id-token", driveAccessToken: "drive-access-token" },
      "public-key",
    );

    controller.dispose();
    controller.dispose();
    expect(MOCKS.disposeIdentityActions).toHaveBeenCalledOnce();
  });

  it("constructs the action graph when delete is the first action", async () => {
    const controller = createBrowserIdentityController(VALID_CONTROLLER_CONFIG);
    await mountWithGoogleCredential(controller);

    await expect(controller.continueGoogle({
      kind: "delete",
      expectedPublicKeyZ32: "public-key",
    })).resolves.toEqual({
      status: "action_completed",
      result: Result.ok({ kind: "deleted" }),
    });
    expect(MOCKS.GoogleIdentityActions).toHaveBeenCalledOnce();
    expect(MOCKS.deleteIdentity).toHaveBeenCalledWith(
      { googleIdToken: "google-id-token", driveAccessToken: "drive-access-token" },
      "public-key",
    );

    controller.dispose();
    expect(MOCKS.disposeIdentityActions).toHaveBeenCalledOnce();
  });

  it("rolls back a partially constructed action graph before retrying", async () => {
    MOCKS.GoogleIdentityActions.mockImplementationOnce(function () {
      throw new Error("construction failed");
    });
    const controller = createBrowserIdentityController(VALID_CONTROLLER_CONFIG);
    await mountWithGoogleCredential(controller);

    const failed = await controller.continueGoogle({ kind: "establish" });
    expect(failed.status).toBe("action_completed");
    if (failed.status !== "action_completed") throw new Error("Expected completed action");
    expect(Result.isError(failed.result)).toBe(true);
    if (!Result.isError(failed.result)) throw new Error("Expected construction failure");
    expect(failed.result.error).toEqual({ code: "unexpected_failure" });
    expect(MOCKS.GoogleIdentityActions).toHaveBeenCalledOnce();
    expect(MOCKS.disposeIdentityActions).not.toHaveBeenCalled();

    emitGoogleCredential();
    await expect(controller.continueGoogle({ kind: "establish" })).resolves.toMatchObject({
      status: "action_completed",
      result: { value: { kind: "established" } },
    });
    expect(MOCKS.GoogleIdentityActions).toHaveBeenCalledTimes(2);

    controller.dispose();
    expect(MOCKS.disposeIdentityActions).toHaveBeenCalledOnce();
  });

  it("defers action graph disposal until an in-flight action settles", async () => {
    let resolveEstablish!: (result: ReturnType<typeof establishedIdentity>) => void;
    MOCKS.establish.mockImplementationOnce(() => new Promise((resolve) => {
      resolveEstablish = resolve;
    }));
    const controller = createBrowserIdentityController(VALID_CONTROLLER_CONFIG);
    await mountWithGoogleCredential(controller);

    const pending = controller.continueGoogle({ kind: "establish" });
    await vi.waitFor(() => expect(MOCKS.establish).toHaveBeenCalledOnce());
    controller.dispose();
    expect(MOCKS.disposeIdentityActions).not.toHaveBeenCalled();

    resolveEstablish(establishedIdentity());
    await expect(pending).resolves.toMatchObject({ status: "action_finished_after_unmount" });
    expect(MOCKS.disposeIdentityActions).toHaveBeenCalledOnce();
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
    source: "restored" as const,
    publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
  });
}
