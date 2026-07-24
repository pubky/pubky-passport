/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../test-utils/fakes/memoryStorage";
import type { GoogleSignInResult } from "./google-sign-in/application/googleSignIn";

type CredentialCallback = (
  result: GoogleSignInResult<{ googleIdToken: string; subject: string }>,
) => void;

const mocks = vi.hoisted(() => ({
  createGoogleBackedIdentityRuntime: vi.fn(),
  disposeIdentityRuntime: vi.fn(),
  establish: vi.fn(),
  deleteIdentity: vi.fn(),
  GoogleIdentityServicesSignInButton: vi.fn(),
  GoogleIdentityServicesDriveAccessRequester: vi.fn(),
  mountGoogleSignIn: vi.fn(),
  unmountGoogleSignIn: vi.fn(),
  requestGoogleDriveAccess: vi.fn(),
  credentialCallback: null as CredentialCallback | null,
}));

vi.mock("./google-backed-identity/composition/createGoogleBackedIdentityRuntime", () => ({
  createGoogleBackedIdentityRuntime: mocks.createGoogleBackedIdentityRuntime,
}));

vi.mock("./google-sign-in/adapters/googleIdentityServicesSignInButton", () => ({
  GoogleIdentityServicesSignInButton: mocks.GoogleIdentityServicesSignInButton,
}));

vi.mock("./google-drive-access/adapters/googleIdentityServicesDriveAccessRequester", () => ({
  GoogleIdentityServicesDriveAccessRequester: mocks.GoogleIdentityServicesDriveAccessRequester,
}));

import { createBrowserIdentityController } from "./createBrowserIdentityController";

const validControllerConfig = {
  googleClientId: "google-client-id",
  homegateBaseUrl: "https://homegate.example/",
};

describe("createBrowserIdentityController", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    mocks.createGoogleBackedIdentityRuntime.mockReset();
    mocks.disposeIdentityRuntime.mockReset();
    mocks.establish.mockReset();
    mocks.deleteIdentity.mockReset();
    mocks.GoogleIdentityServicesSignInButton.mockReset();
    mocks.GoogleIdentityServicesDriveAccessRequester.mockReset();
    mocks.mountGoogleSignIn.mockReset();
    mocks.unmountGoogleSignIn.mockReset();
    mocks.requestGoogleDriveAccess.mockReset();
    mocks.credentialCallback = null;

    mocks.createGoogleBackedIdentityRuntime.mockImplementation(function () {
      return {
        identityEstablisher: { establish: mocks.establish },
        identityDeleter: { execute: mocks.deleteIdentity },
        dispose: mocks.disposeIdentityRuntime,
      };
    });
    mocks.GoogleIdentityServicesSignInButton.mockImplementation(function () {
      return {
        mount: mocks.mountGoogleSignIn,
        unmount: mocks.unmountGoogleSignIn,
      };
    });
    mocks.GoogleIdentityServicesDriveAccessRequester.mockImplementation(function () {
      return { request: mocks.requestGoogleDriveAccess };
    });
    mocks.mountGoogleSignIn.mockImplementation(async (input: {
      onCredential: CredentialCallback;
    }) => {
      mocks.credentialCallback = input.onCredential;
      return Result.ok();
    });
    mocks.requestGoogleDriveAccess.mockResolvedValue(Result.ok("drive-access-token"));
    mocks.establish.mockResolvedValue(Result.ok({
      source: "restored",
      publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
    }));
    mocks.deleteIdentity.mockResolvedValue(Result.ok());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("serves the local identity catalog without constructing the Pubky action graph", () => {
    const controller = createBrowserIdentityController(validControllerConfig);

    const identities = controller.list();
    expect(Result.isError(identities)).toBe(false);
    if (Result.isError(identities)) throw new Error(identities.error.code);
    expect(identities.value).toEqual({ activeIdentityId: null, identities: [] });
    expect(mocks.createGoogleBackedIdentityRuntime).not.toHaveBeenCalled();

    controller.dispose();
    expect(mocks.createGoogleBackedIdentityRuntime).not.toHaveBeenCalled();
  });

  it("constructs one action graph and delegates establish and delete", async () => {
    const controller = createBrowserIdentityController(validControllerConfig);
    await mountWithGoogleCredential(controller);

    await expect(controller.continueGoogle({ kind: "establish" })).resolves.toEqual({
      status: "action_completed",
      result: Result.ok({
        kind: "established",
        source: "restored",
        publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
      }),
    });
    expect(mocks.createGoogleBackedIdentityRuntime).toHaveBeenCalledWith({
      keyStore: expect.anything(),
      homegateBaseUrl: "https://homegate.example/",
      passportOrigin: window.location.origin,
    });
    expect(mocks.establish).toHaveBeenCalledWith({
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
    expect(mocks.createGoogleBackedIdentityRuntime).toHaveBeenCalledOnce();
    expect(mocks.deleteIdentity).toHaveBeenCalledWith(
      { googleIdToken: "google-id-token", driveAccessToken: "drive-access-token" },
      "public-key",
    );

    controller.dispose();
    controller.dispose();
    expect(mocks.disposeIdentityRuntime).toHaveBeenCalledOnce();
  });

  it("constructs the action graph when delete is the first action", async () => {
    const controller = createBrowserIdentityController(validControllerConfig);
    await mountWithGoogleCredential(controller);

    await expect(controller.continueGoogle({
      kind: "delete",
      expectedPublicKeyZ32: "public-key",
    })).resolves.toEqual({
      status: "action_completed",
      result: Result.ok({ kind: "deleted" }),
    });
    expect(mocks.createGoogleBackedIdentityRuntime).toHaveBeenCalledOnce();
    expect(mocks.deleteIdentity).toHaveBeenCalledWith(
      { googleIdToken: "google-id-token", driveAccessToken: "drive-access-token" },
      "public-key",
    );

    controller.dispose();
    expect(mocks.disposeIdentityRuntime).toHaveBeenCalledOnce();
  });

  it("rolls back a partially constructed action graph before retrying", async () => {
    mocks.createGoogleBackedIdentityRuntime.mockImplementationOnce(function () {
      throw new Error("construction failed");
    });
    const controller = createBrowserIdentityController(validControllerConfig);
    await mountWithGoogleCredential(controller);

    const failed = await controller.continueGoogle({ kind: "establish" });
    expect(failed.status).toBe("action_completed");
    if (failed.status !== "action_completed") throw new Error("Expected completed action");
    expect(Result.isError(failed.result)).toBe(true);
    if (!Result.isError(failed.result)) throw new Error("Expected construction failure");
    expect(failed.result.error).toEqual({ code: "unexpected_failure" });
    expect(mocks.createGoogleBackedIdentityRuntime).toHaveBeenCalledOnce();
    expect(mocks.disposeIdentityRuntime).not.toHaveBeenCalled();

    emitGoogleCredential();
    await expect(controller.continueGoogle({ kind: "establish" })).resolves.toMatchObject({
      status: "action_completed",
      result: { value: { kind: "established" } },
    });
    expect(mocks.createGoogleBackedIdentityRuntime).toHaveBeenCalledTimes(2);

    controller.dispose();
    expect(mocks.disposeIdentityRuntime).toHaveBeenCalledOnce();
  });

  it("defers action graph disposal until an in-flight action settles", async () => {
    let resolveEstablish!: (result: ReturnType<typeof establishedIdentity>) => void;
    mocks.establish.mockImplementationOnce(() => new Promise((resolve) => {
      resolveEstablish = resolve;
    }));
    const controller = createBrowserIdentityController(validControllerConfig);
    await mountWithGoogleCredential(controller);

    const pending = controller.continueGoogle({ kind: "establish" });
    await vi.waitFor(() => expect(mocks.establish).toHaveBeenCalledOnce());
    controller.dispose();
    expect(mocks.disposeIdentityRuntime).not.toHaveBeenCalled();

    resolveEstablish(establishedIdentity());
    await expect(pending).resolves.toMatchObject({ status: "action_finished_after_unmount" });
    expect(mocks.disposeIdentityRuntime).toHaveBeenCalledOnce();
  });
});

async function mountWithGoogleCredential(
  controller: ReturnType<typeof createBrowserIdentityController>,
): Promise<void> {
  await controller.mountGoogleSignIn(document.createElement("div"), vi.fn());
  emitGoogleCredential();
}

function emitGoogleCredential(): void {
  mocks.credentialCallback?.(Result.ok({
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
