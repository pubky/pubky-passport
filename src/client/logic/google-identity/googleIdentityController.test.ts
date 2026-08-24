/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "../../../../test-utils/MemoryStorage";
import { expectResultError } from "../../../../test-utils/resultAssertions";
import { LOGGER } from "../../../libs/logger/logger";
import { LocalStorageIdentityRepository } from "../local-identity/LocalStorageIdentityRepository";

const MOCKS = vi.hoisted(() => ({
  GoogleIdentityOperations: vi.fn(),
  GoogleImplicitAuthorization: vi.fn(),
  detachIdentity: vi.fn(),
  abortRequests: vi.fn(),
  disposeAuthorization: vi.fn(),
  disposeOperations: vi.fn(),
  establishIdentity: vi.fn(),
  replaceInvalidPassportFile: vi.fn(),
  requestAuthorization: vi.fn(),
}));

vi.mock("./GoogleIdentityOperations", () => ({
  GoogleIdentityOperations: MOCKS.GoogleIdentityOperations,
}));

vi.mock("./GoogleImplicitAuthorization", () => ({
  GoogleImplicitAuthorization: MOCKS.GoogleImplicitAuthorization,
}));

import {
  GoogleIdentityController,
  type GoogleIdentityViewState,
} from "./GoogleIdentityController";

const GOOGLE_ACCOUNT = {
  googleSubject: "google-account-id",
  email: "satoshi@gmail.com",
  name: "Satoshi Nakamoto",
  pictureUrl: null,
};
const CREDENTIALS = {
  googleIdToken: "google-id-token",
  driveAccessToken: "drive-access-token",
  googleAccount: GOOGLE_ACCOUNT,
};
const PUBLIC_IDENTITY = {
  publicKeyZ32: "public-key",
  publicKeyDisplay: "pubky1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy",
};

describe("GoogleIdentityController", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    for (const mock of Object.values(MOCKS)) mock.mockReset();

    MOCKS.GoogleImplicitAuthorization.mockImplementation(function () { return {
      request: MOCKS.requestAuthorization,
      dispose: MOCKS.disposeAuthorization,
    }; });
    MOCKS.GoogleIdentityOperations.mockImplementation(function () { return {
      establishIdentity: MOCKS.establishIdentity,
      replaceInvalidPassportFile: MOCKS.replaceInvalidPassportFile,
      detachIdentity: MOCKS.detachIdentity,
      abortRequests: MOCKS.abortRequests,
      dispose: MOCKS.disposeOperations,
    }; });
    MOCKS.requestAuthorization.mockResolvedValue(Result.ok(CREDENTIALS));
    MOCKS.establishIdentity.mockImplementation(async (_credentials, reportProgress) => {
      reportProgress({ flow: "lookup", step: "checking" });
      reportProgress({ flow: "restore", step: "restoring" });
      return Result.ok({ establishmentMode: "restored" as const, publicIdentity: PUBLIC_IDENTITY });
    });
    MOCKS.detachIdentity.mockResolvedValue(Result.ok());
    MOCKS.replaceInvalidPassportFile.mockResolvedValue(Result.ok({
      establishmentMode: "created" as const,
      publicIdentity: PUBLIC_IDENTITY,
      visibleRecoveryCopyStatus: "created" as const,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("composes its screen-scoped dependencies during construction", () => {
    const onState = vi.fn();

    new GoogleIdentityController({
      googleClientId: "google-client-id",
      homegateBaseUrl: "https://homegate.example/",
    }, onState);

    expect(MOCKS.GoogleImplicitAuthorization).toHaveBeenCalledWith("google-client-id");
    expect(MOCKS.GoogleIdentityOperations).toHaveBeenCalledWith(
      expect.any(LocalStorageIdentityRepository),
      "https://homegate.example/",
      window.location.origin,
    );
  });

  it("logs controller construction failures without sensitive configuration", () => {
    const error = vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    MOCKS.GoogleImplicitAuthorization.mockImplementationOnce(() => {
      throw new Error("SECRET-CONFIGURATION-VALUE");
    });

    expect(() => new GoogleIdentityController({
      googleClientId: "SECRET-CLIENT-ID",
      homegateBaseUrl: "https://secret-homegate.example/",
    }, vi.fn())).toThrow("SECRET-CONFIGURATION-VALUE");
    expect(error).toHaveBeenCalledWith("identity.google.controller.failed", {
      operation: "initialize",
      code: "runtime_exception",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET");
  });

  it("reports authorization and establishment progress", async () => {
    const states: GoogleIdentityViewState[] = [];
    const controller = createController((state) => states.push(state));

    await expect(controller.establishIdentity()).resolves.toEqual(Result.ok({
      establishmentMode: "restored",
      googleAccount: GOOGLE_ACCOUNT,
      publicIdentity: PUBLIC_IDENTITY,
    }));

    expect(states).toEqual([
      { status: "requesting-authorization" },
      { status: "establishing", progress: { flow: "lookup", step: "checking" } },
      { status: "establishing", progress: { flow: "restore", step: "restoring" } },
    ]);
    expect(MOCKS.establishIdentity).toHaveBeenCalledWith(CREDENTIALS, expect.any(Function));
  });

  it("forwards restored-identity repair progress unchanged", async () => {
    MOCKS.establishIdentity.mockImplementation(async (_credentials, reportProgress) => {
      reportProgress({ flow: "repair", step: "signing_up" });
      reportProgress({ flow: "repair", step: "publishing" });
      reportProgress({ flow: "repair", step: "signing_in" });
      return Result.ok({ establishmentMode: "restored" as const, publicIdentity: PUBLIC_IDENTITY });
    });
    const states: GoogleIdentityViewState[] = [];

    await createController((state) => states.push(state)).establishIdentity();

    expect(states).toEqual([
      { status: "requesting-authorization" },
      { status: "establishing", progress: { flow: "repair", step: "signing_up" } },
      { status: "establishing", progress: { flow: "repair", step: "publishing" } },
      { status: "establishing", progress: { flow: "repair", step: "signing_in" } },
    ]);
  });

  it("contains state listener details without failing establishment", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const controller = createController(() => {
      throw new Error("sensitive-state-listener");
    });

    await expect(controller.establishIdentity()).resolves.toEqual(Result.ok({
      establishmentMode: "restored",
      googleAccount: GOOGLE_ACCOUNT,
      publicIdentity: PUBLIC_IDENTITY,
    }));

    expect(warning).toHaveBeenCalledWith("identity.google.state_listener.failed");
    expect(JSON.stringify(warning.mock.calls)).not.toContain("sensitive-state-listener");
  });

  it("returns a direct authorization error without invoking identity operations", async () => {
    MOCKS.requestAuthorization.mockResolvedValue(Result.err({
      code: "google_authorization_popup_closed" as const,
    }));
    const controller = createController();

    expectResultError(await controller.establishIdentity(), { code: "google_authorization_popup_closed" });
    expect(MOCKS.establishIdentity).not.toHaveBeenCalled();
  });

  it("rejects a different Google account before delegation", async () => {
    MOCKS.requestAuthorization.mockResolvedValue(Result.ok({
      ...CREDENTIALS,
      googleAccount: { ...GOOGLE_ACCOUNT, googleSubject: "different-account" },
    }));
    const controller = createController();

    expectResultError(
      await controller.detachIdentity(PUBLIC_IDENTITY, GOOGLE_ACCOUNT.googleSubject),
      { code: "authorization_failed" },
    );
    expect(MOCKS.detachIdentity).not.toHaveBeenCalled();
  });

  it("pins establishment retries to the first authorized Google account", async () => {
    const controller = createController();
    await controller.establishIdentity();
    MOCKS.requestAuthorization.mockResolvedValueOnce(Result.ok({
      ...CREDENTIALS,
      googleAccount: { ...GOOGLE_ACCOUNT, googleSubject: "different-account" },
    }));

    expectResultError(await controller.establishIdentity(), { code: "authorization_failed" });

    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(1, undefined);
    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(2, GOOGLE_ACCOUNT.googleSubject);
    expect(MOCKS.establishIdentity).toHaveBeenCalledOnce();
  });

  it("allows a new establishment flow to choose another Google account", async () => {
    const controller = createController();
    await controller.establishIdentity();

    controller.clearPinnedGoogleSubject();
    await controller.establishIdentity();

    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(1, undefined);
    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(2, undefined);
  });

  it("delegates detachment behavior", async () => {
    const controller = createController();

    await expect(controller.detachIdentity(PUBLIC_IDENTITY, GOOGLE_ACCOUNT.googleSubject)).resolves.toEqual(
      Result.ok(),
    );

    expect(MOCKS.detachIdentity).toHaveBeenCalledWith(CREDENTIALS, PUBLIC_IDENTITY, GOOGLE_ACCOUNT.googleSubject);
  });

  it("preserves safe typed detachment errors for the UI", async () => {
    MOCKS.detachIdentity.mockResolvedValue(Result.err({
      code: "google_drive_cleanup_failed" as const,
    }));

    expectResultError(
      await createController().detachIdentity(PUBLIC_IDENTITY, GOOGLE_ACCOUNT.googleSubject),
      { code: "google_drive_cleanup_failed" },
    );
  });

  it("returns a safe sign-in error without identity recovery metadata", async () => {
    MOCKS.establishIdentity.mockResolvedValue(Result.err({
      code: "signin_failed" as const,
    }));

    expectResultError(await createController().establishIdentity(), {
      code: "signin_failed",
    });
  });

  it("preserves safe typed operation errors for the UI", async () => {
    MOCKS.establishIdentity.mockResolvedValue(Result.err({
      code: "homeserver_signup_invitation_failed" as const,
      cause: "weekly_limit_exceeded" as const,
    }));

    expectResultError(await createController().establishIdentity(), {
      code: "homeserver_signup_invitation_failed",
      cause: "weekly_limit_exceeded",
    });
  });

  it("replaces an invalid file with the pinned Google account and returns the created identity", async () => {
    const controller = createController();
    MOCKS.establishIdentity.mockResolvedValueOnce(Result.err({ code: "invalid_passport_file" as const }));
    await controller.establishIdentity();

    await expect(controller.replaceInvalidPassportFile()).resolves.toEqual(Result.ok({
      establishmentMode: "created",
      googleAccount: GOOGLE_ACCOUNT,
      publicIdentity: PUBLIC_IDENTITY,
      visibleRecoveryCopyStatus: "created",
    }));

    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(2, GOOGLE_ACCOUNT.googleSubject);
    expect(MOCKS.replaceInvalidPassportFile).toHaveBeenCalledWith(CREDENTIALS, expect.any(Function));
  });

  it("rejects a different Google account before invalid-file replacement", async () => {
    const controller = createController();
    MOCKS.establishIdentity.mockResolvedValueOnce(Result.err({ code: "invalid_passport_file" as const }));
    await controller.establishIdentity();
    MOCKS.requestAuthorization.mockResolvedValueOnce(Result.ok({
      ...CREDENTIALS,
      googleAccount: { ...GOOGLE_ACCOUNT, googleSubject: "different-account" },
    }));

    expectResultError(await controller.replaceInvalidPassportFile(), { code: "authorization_failed" });
    expect(MOCKS.replaceInvalidPassportFile).not.toHaveBeenCalled();
  });

  it("defers operation cleanup until in-flight work settles", async () => {
    let finish!: () => void;
    MOCKS.establishIdentity.mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve(Result.ok({
        establishmentMode: "restored" as const,
        publicIdentity: PUBLIC_IDENTITY,
      }));
    }));
    const controller = createController();

    const pending = controller.establishIdentity();
    await vi.waitFor(() => expect(MOCKS.establishIdentity).toHaveBeenCalledOnce());
    controller.dispose();
    expect(MOCKS.abortRequests).toHaveBeenCalledOnce();
    expect(MOCKS.disposeOperations).not.toHaveBeenCalled();
    finish();

    expectResultError(await pending, { code: "cancelled" });
    expect(MOCKS.disposeOperations).toHaveBeenCalledOnce();
  });

  it("does not start identity operations when disposed as authorization settles", async () => {
    let authorize!: () => void;
    MOCKS.requestAuthorization.mockImplementation(() => new Promise((resolve) => {
      authorize = () => resolve(Result.ok(CREDENTIALS));
    }));
    const controller = createController();
    const pending = controller.establishIdentity();

    authorize();
    queueMicrotask(() => controller.dispose());

    expectResultError(await pending, { code: "cancelled" });
    expect(MOCKS.establishIdentity).not.toHaveBeenCalled();
    expect(MOCKS.disposeOperations).toHaveBeenCalledOnce();
  });

  it("rejects a concurrent operation without another authorization", async () => {
    let finish!: () => void;
    MOCKS.establishIdentity.mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve(Result.ok({
        establishmentMode: "restored" as const,
        publicIdentity: PUBLIC_IDENTITY,
      }));
    }));
    const controller = createController();

    const first = controller.establishIdentity();
    await vi.waitFor(() => expect(MOCKS.establishIdentity).toHaveBeenCalledOnce());
    expectResultError(
      await controller.detachIdentity(PUBLIC_IDENTITY, GOOGLE_ACCOUNT.googleSubject),
      { code: "operation_failed" },
    );
    expect(MOCKS.requestAuthorization).toHaveBeenCalledOnce();
    finish();
    await first;
  });
});

function createController(
  onState: (state: GoogleIdentityViewState) => void = vi.fn(),
): GoogleIdentityController {
  return new GoogleIdentityController(
    {
      googleClientId: "google-client-id",
      homegateBaseUrl: "https://homegate.example/",
    },
    onState,
  );
}
