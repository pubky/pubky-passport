/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectResultError } from "../../../../test-utils/resultAssertions";
import { LOGGER } from "@/libs/logger/logger";
import { GoogleIdentityController, type GoogleIdentityViewState } from "./GoogleIdentityController";

const MOCKS = {
  detachIdentity: vi.fn(),
  abortRequests: vi.fn(),
  disposeAuthorization: vi.fn(),
  disposeLifecycle: vi.fn(),
  establishIdentity: vi.fn(),
  replaceInvalidPassportFile: vi.fn(),
  requestAuthorization: vi.fn(),
};

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
};

describe("GoogleIdentityController", () => {
  beforeEach(() => {
    for (const mock of Object.values(MOCKS)) mock.mockReset();
    MOCKS.requestAuthorization.mockResolvedValue(Result.ok(CREDENTIALS));
    MOCKS.establishIdentity.mockImplementation(async (_credentials, reportProgress) => {
      reportProgress({ flow: "lookup", step: "checking" });
      reportProgress({ flow: "restore", step: "restoring" });
      return Result.ok({ establishmentMode: "restored" as const, publicIdentity: PUBLIC_IDENTITY });
    });
    MOCKS.detachIdentity.mockResolvedValue(Result.ok());
    MOCKS.replaceInvalidPassportFile.mockResolvedValue(
      Result.ok({
        establishmentMode: "created" as const,
        publicIdentity: PUBLIC_IDENTITY,
        visibleRecoveryCopyStatus: "created" as const,
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("composes and disposes its real screen-scoped dependencies", () => {
    const session = new GoogleIdentityController("google-client-id", "https://homegate.example/");
    expect(() => session.dispose()).not.toThrow();
  });

  it("runs the real authorization and lifecycle constructors when no factories are injected", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const open = vi.fn(() => null);
    vi.stubGlobal("open", open);
    const controller = new GoogleIdentityController(
      "google-client-id",
      "https://homegate.example/",
    );

    expectResultError(await controller.establishIdentity(), {
      code: "google_authorization_popup_failed_to_open",
    });
    expect(open).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("lets a single injected factory replace only its own constructor", async () => {
    const controller = new GoogleIdentityController(
      "google-client-id",
      "https://homegate.example/",
      undefined,
      () => ({
        abortRequests: MOCKS.abortRequests,
        detachIdentity: MOCKS.detachIdentity,
        dispose: MOCKS.disposeLifecycle,
        establishIdentity: MOCKS.establishIdentity,
        replaceInvalidPassportFile: MOCKS.replaceInvalidPassportFile,
      }),
    );
    const states = recordStates(controller);
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const open = vi.fn(() => null);
    vi.stubGlobal("open", open);

    expectResultError(await controller.establishIdentity(), {
      code: "google_authorization_popup_failed_to_open",
    });
    expect(open).toHaveBeenCalledOnce();
    expect(MOCKS.establishIdentity).not.toHaveBeenCalled();
    expect(states).toEqual([
      { status: "requesting-authorization" },
      { status: "failed", error: { code: "google_authorization_popup_failed_to_open" } },
    ]);
  });

  it("starts idle and publishes authorization, establishment progress, and the result", async () => {
    const controller = createController();
    const states = recordStates(controller);
    const established = {
      establishmentMode: "restored" as const,
      googleAccount: GOOGLE_ACCOUNT,
      publicIdentity: PUBLIC_IDENTITY,
    };

    expect(controller.getState()).toEqual({ status: "idle" });
    await expect(controller.establishIdentity()).resolves.toEqual(Result.ok(established));

    expect(states).toEqual([
      { status: "requesting-authorization" },
      { status: "establishing", progress: { flow: "lookup", step: "checking" } },
      { status: "establishing", progress: { flow: "restore", step: "restoring" } },
      { status: "established", identity: established },
    ]);
    expect(controller.getState()).toEqual({ status: "established", identity: established });
    expect(MOCKS.establishIdentity).toHaveBeenCalledWith(CREDENTIALS, expect.any(Function));
  });

  it("forwards restored-identity repair progress unchanged", async () => {
    MOCKS.establishIdentity.mockImplementation(async (_credentials, reportProgress) => {
      reportProgress({ flow: "repair", step: "signing_up" });
      reportProgress({ flow: "repair", step: "publishing" });
      reportProgress({ flow: "repair", step: "signing_in" });
      return Result.ok({ establishmentMode: "restored" as const, publicIdentity: PUBLIC_IDENTITY });
    });
    const controller = createController();
    const states = recordStates(controller);

    await controller.establishIdentity();

    expect(states.slice(0, 4)).toEqual([
      { status: "requesting-authorization" },
      { status: "establishing", progress: { flow: "repair", step: "signing_up" } },
      { status: "establishing", progress: { flow: "repair", step: "publishing" } },
      { status: "establishing", progress: { flow: "repair", step: "signing_in" } },
    ]);
  });

  it("publishes safe failures and returns to idle on reset", async () => {
    MOCKS.requestAuthorization.mockResolvedValue(
      Result.err({ code: "google_authorization_denied" as const }),
    );
    const controller = createController();
    const states = recordStates(controller);

    await controller.establishIdentity();
    expect(controller.getState()).toEqual({
      status: "failed",
      error: { code: "google_authorization_denied" },
    });

    controller.reset();
    expect(controller.getState()).toEqual({ status: "idle" });
    expect(states).toEqual([
      { status: "requesting-authorization" },
      { status: "failed", error: { code: "google_authorization_denied" } },
      { status: "idle" },
    ]);
  });

  it("publishes detachment progress and completion", async () => {
    const controller = createController();
    const states = recordStates(controller);

    await controller.detachIdentity(PUBLIC_IDENTITY, GOOGLE_ACCOUNT.googleSubject);

    expect(states).toEqual([
      { status: "requesting-authorization" },
      { status: "detaching" },
      { status: "detached" },
    ]);
  });

  it("contains state listener details without failing establishment", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const listenerError = Object.assign(new Error("listener failed"), {
      secret: "sensitive-state-listener",
    });
    const controller = createController();
    controller.subscribe(() => {
      throw listenerError;
    });

    await expect(controller.establishIdentity()).resolves.toEqual(
      Result.ok({
        establishmentMode: "restored",
        googleAccount: GOOGLE_ACCOUNT,
        publicIdentity: PUBLIC_IDENTITY,
      }),
    );

    expect(warning).toHaveBeenCalledWith(
      "identity.google.state_listener.failed",
      expect.objectContaining({
        state: "requesting-authorization",
        diagnosticId: expect.any(String),
        errorName: "Error",
      }),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("sensitive-state-listener");
  });

  it("returns a direct authorization error without invoking the identity lifecycle", async () => {
    MOCKS.requestAuthorization.mockResolvedValue(
      Result.err({
        code: "google_authorization_popup_closed" as const,
      }),
    );
    const controller = createController();

    expectResultError(await controller.establishIdentity(), {
      code: "google_authorization_popup_closed",
    });
    expect(MOCKS.establishIdentity).not.toHaveBeenCalled();
  });

  it("rejects a different Google account before delegation", async () => {
    MOCKS.requestAuthorization.mockResolvedValue(
      Result.ok({
        ...CREDENTIALS,
        googleAccount: { ...GOOGLE_ACCOUNT, googleSubject: "different-account" },
      }),
    );
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
    MOCKS.requestAuthorization.mockResolvedValueOnce(
      Result.ok({
        ...CREDENTIALS,
        googleAccount: { ...GOOGLE_ACCOUNT, googleSubject: "different-account" },
      }),
    );

    expectResultError(await controller.establishIdentity(), { code: "authorization_failed" });

    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(1, undefined);
    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(2, GOOGLE_ACCOUNT.googleSubject);
    expect(MOCKS.establishIdentity).toHaveBeenCalledOnce();
  });

  it("allows a new establishment flow to choose another Google account", async () => {
    const controller = createController();
    await controller.establishIdentity();

    controller.reset();
    await controller.establishIdentity();

    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(1, undefined);
    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(2, undefined);
  });

  it("delegates detachment behavior", async () => {
    const controller = createController();

    await expect(
      controller.detachIdentity(PUBLIC_IDENTITY, GOOGLE_ACCOUNT.googleSubject),
    ).resolves.toEqual(Result.ok());

    expect(MOCKS.detachIdentity).toHaveBeenCalledWith(
      CREDENTIALS,
      PUBLIC_IDENTITY,
      GOOGLE_ACCOUNT.googleSubject,
    );
  });

  it("preserves safe typed detachment errors for the UI", async () => {
    MOCKS.detachIdentity.mockResolvedValue(
      Result.err({
        code: "google_drive_cleanup_failed" as const,
      }),
    );

    expectResultError(
      await createController().detachIdentity(PUBLIC_IDENTITY, GOOGLE_ACCOUNT.googleSubject),
      { code: "google_drive_cleanup_failed" },
    );
  });

  it("returns a safe sign-in error without identity recovery metadata", async () => {
    MOCKS.establishIdentity.mockResolvedValue(
      Result.err({
        code: "signin_failed" as const,
      }),
    );

    expectResultError(await createController().establishIdentity(), {
      code: "signin_failed",
    });
  });

  it("preserves safe operation classifications without diagnostic causes", async () => {
    const diagnosticCanary = { secret: "CONTROLLER-CAUSE-CANARY" };
    const operationError = {
      code: "homeserver_signup_token_failed" as const,
      detailCode: "weekly_limit_exceeded" as const,
      cause: diagnosticCanary,
    };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.establishIdentity.mockResolvedValue(Result.err(operationError));

    const result = await createController().establishIdentity();

    expectResultError(result, {
      code: "homeserver_signup_token_failed",
      detailCode: "weekly_limit_exceeded",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("CONTROLLER-CAUSE-CANARY");
  });

  it("classifies broad operation exceptions without exposing their details", async () => {
    const thrown = { secret: "CONTROLLER-BROAD-CATCH-CANARY" };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.establishIdentity.mockRejectedValue(thrown);

    expectResultError(await createController().establishIdentity(), {
      code: "operation_failed",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("CONTROLLER-BROAD-CATCH-CANARY");
  });

  it("classifies authorization promise exceptions without exposing their details", async () => {
    const thrown = { secret: "AUTHORIZATION-BROAD-CATCH-CANARY" };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.requestAuthorization.mockRejectedValue(thrown);

    expectResultError(await createController().establishIdentity(), {
      code: "authorization_failed",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("AUTHORIZATION-BROAD-CATCH-CANARY");
  });

  it("replaces an invalid file with the pinned Google account and returns the created identity", async () => {
    const controller = createController();
    MOCKS.establishIdentity.mockResolvedValueOnce(
      Result.err({ code: "invalid_passport_file" as const }),
    );
    await controller.establishIdentity();

    await expect(controller.replaceInvalidPassportFile()).resolves.toEqual(
      Result.ok({
        establishmentMode: "created",
        googleAccount: GOOGLE_ACCOUNT,
        publicIdentity: PUBLIC_IDENTITY,
        visibleRecoveryCopyStatus: "created",
      }),
    );

    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(2, GOOGLE_ACCOUNT.googleSubject);
    expect(MOCKS.replaceInvalidPassportFile).toHaveBeenCalledWith(
      CREDENTIALS,
      expect.any(Function),
    );
  });

  it("rejects a different Google account before invalid-file replacement", async () => {
    const controller = createController();
    MOCKS.establishIdentity.mockResolvedValueOnce(
      Result.err({ code: "invalid_passport_file" as const }),
    );
    await controller.establishIdentity();
    MOCKS.requestAuthorization.mockResolvedValueOnce(
      Result.ok({
        ...CREDENTIALS,
        googleAccount: { ...GOOGLE_ACCOUNT, googleSubject: "different-account" },
      }),
    );

    expectResultError(await controller.replaceInvalidPassportFile(), {
      code: "authorization_failed",
    });
    expect(MOCKS.replaceInvalidPassportFile).not.toHaveBeenCalled();
  });

  it("defers operation cleanup until in-flight work settles and suppresses later states", async () => {
    let finish!: () => void;
    MOCKS.establishIdentity.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve(
              Result.ok({
                establishmentMode: "restored" as const,
                publicIdentity: PUBLIC_IDENTITY,
              }),
            );
        }),
    );
    const controller = createController();
    const states = recordStates(controller);

    const pending = controller.establishIdentity();
    await vi.waitFor(() => expect(MOCKS.establishIdentity).toHaveBeenCalledOnce());
    controller.dispose();
    expect(MOCKS.abortRequests).toHaveBeenCalledOnce();
    expect(MOCKS.disposeLifecycle).not.toHaveBeenCalled();
    finish();

    expectResultError(await pending, { code: "cancelled" });
    expect(MOCKS.disposeLifecycle).toHaveBeenCalledOnce();
    expect(states).toEqual([{ status: "requesting-authorization" }]);
    expect(controller.getState()).toEqual({ status: "requesting-authorization" });
  });

  it("does not start the identity lifecycle when disposed as authorization settles", async () => {
    let authorize!: () => void;
    MOCKS.requestAuthorization.mockImplementation(
      () =>
        new Promise((resolve) => {
          authorize = () => resolve(Result.ok(CREDENTIALS));
        }),
    );
    const controller = createController();
    const pending = controller.establishIdentity();

    await vi.waitFor(() => expect(MOCKS.requestAuthorization).toHaveBeenCalledOnce());
    authorize();
    queueMicrotask(() => controller.dispose());

    expectResultError(await pending, { code: "cancelled" });
    expect(MOCKS.establishIdentity).not.toHaveBeenCalled();
    expect(MOCKS.disposeLifecycle).toHaveBeenCalledOnce();
  });

  it("rejects a concurrent operation without another authorization", async () => {
    let finish!: () => void;
    MOCKS.establishIdentity.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve(
              Result.ok({
                establishmentMode: "restored" as const,
                publicIdentity: PUBLIC_IDENTITY,
              }),
            );
        }),
    );
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

function recordStates(controller: GoogleIdentityController): GoogleIdentityViewState[] {
  const states: GoogleIdentityViewState[] = [];
  controller.subscribe((state) => states.push(state));
  return states;
}

function createController(): GoogleIdentityController {
  return new GoogleIdentityController(
    "google-client-id",
    "https://homegate.example/",
    () => ({
      request: MOCKS.requestAuthorization,
      dispose: MOCKS.disposeAuthorization,
    }),
    () => ({
      abortRequests: MOCKS.abortRequests,
      detachIdentity: MOCKS.detachIdentity,
      dispose: MOCKS.disposeLifecycle,
      establishIdentity: MOCKS.establishIdentity,
      replaceInvalidPassportFile: MOCKS.replaceInvalidPassportFile,
    }),
  );
}
