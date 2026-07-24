/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GoogleSignInWidgetResult } from "./application/ports/google/googleSignIn";

type CredentialCallback = (
  result: GoogleSignInWidgetResult<{ googleIdToken: string; subject: string }>,
) => void;

const mocks = vi.hoisted(() => ({
  BrowserPubky: vi.fn(),
  disposePubky: vi.fn(),
  EstablishGoogleBackedIdentity: vi.fn(),
  establish: vi.fn(),
  DeleteGoogleDriveIdentity: vi.fn(),
  deleteIdentity: vi.fn(),
  GoogleSignInWidget: vi.fn(),
  mountGoogleSignIn: vi.fn(),
  unmountGoogleSignIn: vi.fn(),
  requestGoogleDriveAccess: vi.fn(),
  BrowserGoogleHomegateInviteRequester: vi.fn(),
  credentialCallback: null as CredentialCallback | null,
}));

vi.mock("../pubky/browserPubky", () => ({
  BrowserPubky: mocks.BrowserPubky,
}));

vi.mock("./application/establishGoogleBackedIdentity", () => ({
  EstablishGoogleBackedIdentity: mocks.EstablishGoogleBackedIdentity,
}));

vi.mock("./application/deleteGoogleDriveIdentity", () => ({
  DeleteGoogleDriveIdentity: mocks.DeleteGoogleDriveIdentity,
}));

vi.mock("./adapters/google/googleSignInWidget", () => ({
  GoogleSignInWidget: mocks.GoogleSignInWidget,
}));

vi.mock("./adapters/google/googleIdentityProvider", () => ({
  requestGoogleDriveAccess: mocks.requestGoogleDriveAccess,
}));

vi.mock("./adapters/google/googleHomegateInviteRequester", () => ({
  BrowserGoogleHomegateInviteRequester: mocks.BrowserGoogleHomegateInviteRequester,
}));

import { createBrowserIdentityController } from "./createBrowserIdentityController";

const validControllerConfig = {
  googleClientId: "google-client-id",
  homegateBaseUrl: "https://homegate.example/",
};

describe("createBrowserIdentityController", () => {
  beforeEach(() => {
    mocks.BrowserPubky.mockReset();
    mocks.disposePubky.mockReset();
    mocks.EstablishGoogleBackedIdentity.mockReset();
    mocks.establish.mockReset();
    mocks.DeleteGoogleDriveIdentity.mockReset();
    mocks.deleteIdentity.mockReset();
    mocks.GoogleSignInWidget.mockReset();
    mocks.mountGoogleSignIn.mockReset();
    mocks.unmountGoogleSignIn.mockReset();
    mocks.requestGoogleDriveAccess.mockReset();
    mocks.BrowserGoogleHomegateInviteRequester.mockReset();
    mocks.credentialCallback = null;

    mocks.BrowserPubky.mockImplementation(function () {
      return { dispose: mocks.disposePubky };
    });
    mocks.EstablishGoogleBackedIdentity.mockImplementation(function () {
      return { establish: mocks.establish };
    });
    mocks.DeleteGoogleDriveIdentity.mockImplementation(function () {
      return { execute: mocks.deleteIdentity };
    });
    mocks.GoogleSignInWidget.mockImplementation(function () {
      return {
        mount: mocks.mountGoogleSignIn,
        unmount: mocks.unmountGoogleSignIn,
      };
    });
    mocks.BrowserGoogleHomegateInviteRequester.mockImplementation(function () {
      return {};
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
  afterEach(() => localStorage.clear());

  it("serves the local identity catalog without constructing the Pubky action graph", () => {
    const controller = createBrowserIdentityController(validControllerConfig);

    const identities = controller.list();
    expect(Result.isError(identities)).toBe(false);
    if (Result.isError(identities)) throw new Error(identities.error.code);
    expect(identities.value).toEqual({ activeIdentityId: null, identities: [] });
    expect(mocks.BrowserPubky).not.toHaveBeenCalled();

    controller.dispose();
    expect(mocks.BrowserPubky).not.toHaveBeenCalled();
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
    expect(mocks.BrowserPubky).toHaveBeenCalledOnce();
    expect(mocks.BrowserGoogleHomegateInviteRequester).toHaveBeenCalledWith({
      homegateBaseUrl: "https://homegate.example/",
    });
    expect(mocks.DeleteGoogleDriveIdentity).toHaveBeenCalledWith(expect.objectContaining({
      passportOrigin: window.location.origin,
    }));
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
    expect(mocks.BrowserPubky).toHaveBeenCalledOnce();
    expect(mocks.deleteIdentity).toHaveBeenCalledWith(
      { googleIdToken: "google-id-token", driveAccessToken: "drive-access-token" },
      "public-key",
    );

    controller.dispose();
    controller.dispose();
    expect(mocks.disposePubky).toHaveBeenCalledOnce();
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
    expect(mocks.BrowserPubky).toHaveBeenCalledOnce();
    expect(mocks.deleteIdentity).toHaveBeenCalledWith(
      { googleIdToken: "google-id-token", driveAccessToken: "drive-access-token" },
      "public-key",
    );

    controller.dispose();
    expect(mocks.disposePubky).toHaveBeenCalledOnce();
  });

  it("rolls back a partially constructed action graph before retrying", async () => {
    mocks.EstablishGoogleBackedIdentity.mockImplementationOnce(function () {
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
    expect(mocks.BrowserPubky).toHaveBeenCalledOnce();
    expect(mocks.disposePubky).toHaveBeenCalledOnce();

    emitGoogleCredential();
    await expect(controller.continueGoogle({ kind: "establish" })).resolves.toMatchObject({
      status: "action_completed",
      result: { value: { kind: "established" } },
    });
    expect(mocks.BrowserPubky).toHaveBeenCalledTimes(2);
    expect(mocks.EstablishGoogleBackedIdentity).toHaveBeenCalledTimes(2);

    controller.dispose();
    expect(mocks.disposePubky).toHaveBeenCalledTimes(2);
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
    expect(mocks.disposePubky).not.toHaveBeenCalled();

    resolveEstablish(establishedIdentity());
    await expect(pending).resolves.toMatchObject({ status: "action_finished_after_unmount" });
    expect(mocks.disposePubky).toHaveBeenCalledOnce();
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
