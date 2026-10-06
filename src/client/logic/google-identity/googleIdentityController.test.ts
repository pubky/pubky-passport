/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectResultError } from "@test-utils/resultAssertions";
import { LOGGER } from "@/libs/logger/logger";
import { AuthorizationPopup } from "./gia/AuthorizationPopup";
import { GoogleIdentityController, type GoogleIdentityViewState } from "./GoogleIdentityController";

const MOCKS = {
  detachIdentity: vi.fn(),
  backupIdentity: vi.fn(),
  abortRequests: vi.fn(),
  cancelAuthorization: vi.fn(),
  disposeAuthorization: vi.fn(),
  disposeLifecycle: vi.fn(),
  establishIdentity: vi.fn(),
  replaceInvalidPassportFile: vi.fn(),
  replaceUndecryptablePassportFile: vi.fn(),
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
  driveAccessTokenExpiresAt: Date.now() + 3_600_000,
  visibleBackupPermissionGranted: true,
  googleAccount: GOOGLE_ACCOUNT,
};
const PUBLIC_IDENTITY = {
  publicKeyZ32: "public-key",
};

describe("GoogleIdentityController", () => {
  beforeEach(() => {
    for (const mock of Object.values(MOCKS)) mock.mockReset();
    // jsdom's window.open returns undefined, which the controller would report as blocked.
    vi.stubGlobal(
      "open",
      vi.fn(() => createPopupWindow().window),
    );
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
    MOCKS.replaceUndecryptablePassportFile.mockResolvedValue(
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

  it("backs up with render-safe states and reuses credentials for optional-copy consent", async () => {
    const controller = createController();
    const states = recordStates(controller);
    MOCKS.backupIdentity
      .mockResolvedValueOnce(Result.err({ code: "visible_backup_permission_missing" }))
      .mockResolvedValueOnce(
        Result.ok({ googleAccount: GOOGLE_ACCOUNT, visibleRecoveryCopyStatus: "skipped" }),
      );
    await controller.backupIdentity(PUBLIC_IDENTITY);
    expect(controller.getState()).toEqual({
      status: "failed",
      error: { code: "visible_backup_permission_missing" },
    });
    await controller.continueBackupWithoutVisibleCopy();
    expect(MOCKS.requestAuthorization).toHaveBeenCalledOnce();
    expect(MOCKS.backupIdentity).toHaveBeenLastCalledWith(CREDENTIALS, PUBLIC_IDENTITY, true);
    // The account is named on the completion screen; nothing else from the lifecycle is kept.
    expect(controller.getState()).toEqual({
      status: "backed-up",
      backup: { googleAccount: GOOGLE_ACCOUNT, visibleRecoveryCopyStatus: "skipped" },
    });
    // Reused credentials publish backup progress, never an establishment state.
    expect(states.map((state) => state.status)).not.toContain("establishing");
    expect(JSON.stringify(states)).not.toContain(CREDENTIALS.driveAccessToken);
    expect(JSON.stringify(states)).not.toContain(CREDENTIALS.googleIdToken);
  });

  it("keeps a paused backup and a paused establishment from continuing each other", async () => {
    const controller = createController();
    expectResultError(await controller.continueBackupWithoutVisibleCopy(), {
      code: "operation_failed",
    });

    MOCKS.backupIdentity.mockResolvedValueOnce(
      Result.err({ code: "visible_backup_permission_missing" }),
    );
    await controller.backupIdentity(PUBLIC_IDENTITY);
    expectResultError(await controller.continueWithoutVisibleBackup(), {
      code: "operation_failed",
    });
    expect(MOCKS.establishIdentity).not.toHaveBeenCalled();

    MOCKS.establishIdentity.mockResolvedValueOnce(
      Result.err({ code: "visible_backup_permission_missing" }),
    );
    await controller.establishIdentity();
    expectResultError(await controller.continueBackupWithoutVisibleCopy(), {
      code: "operation_failed",
    });
    expect(MOCKS.backupIdentity).toHaveBeenCalledOnce();
  });

  it("renews expired credentials for the same account when continuing a paused backup", async () => {
    const controller = createController();
    MOCKS.requestAuthorization
      .mockResolvedValueOnce(
        Result.ok({
          ...CREDENTIALS,
          driveAccessTokenExpiresAt: 0,
          visibleBackupPermissionGranted: false,
        }),
      )
      .mockResolvedValueOnce(Result.ok(CREDENTIALS));
    MOCKS.backupIdentity
      .mockResolvedValueOnce(Result.err({ code: "visible_backup_permission_missing" }))
      .mockResolvedValueOnce(
        Result.ok({ googleAccount: GOOGLE_ACCOUNT, visibleRecoveryCopyStatus: "created" }),
      );

    await controller.backupIdentity(PUBLIC_IDENTITY);
    expect(Result.isOk(await controller.continueBackupWithoutVisibleCopy())).toBe(true);

    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(
      2,
      expect.any(AuthorizationPopup),
      GOOGLE_ACCOUNT.googleSubject,
    );
    expect(MOCKS.backupIdentity).toHaveBeenLastCalledWith(CREDENTIALS, PUBLIC_IDENTITY, true);
  });

  it("keeps the Google account pinned when a backup is retried without reset", async () => {
    const controller = createController();
    MOCKS.backupIdentity.mockResolvedValue(
      Result.err({ code: "google_backup_created_not_linked" }),
    );
    await controller.backupIdentity(PUBLIC_IDENTITY);
    await controller.backupIdentity(PUBLIC_IDENTITY);
    expect(MOCKS.requestAuthorization).toHaveBeenLastCalledWith(
      expect.any(AuthorizationPopup),
      GOOGLE_ACCOUNT.googleSubject,
    );
  });

  it("publishes a foreign file's origin for display without its diagnostic cause", async () => {
    const controller = createController();
    MOCKS.establishIdentity.mockResolvedValue(
      Result.err({
        code: "foreign_passport_file",
        passportFileOrigin: "https://other.example",
        cause: new Error("FOREIGN-CAUSE-CANARY"),
      }),
    );

    const error = {
      code: "foreign_passport_file" as const,
      passportFileOrigin: "https://other.example",
    };
    expectResultError(await controller.establishIdentity(), error);
    expect(controller.getState()).toEqual({ status: "failed", error });
  });

  it("clears the selected Google account on reset so backup conflicts can use another account", async () => {
    const controller = createController();
    MOCKS.backupIdentity.mockResolvedValue(Result.err({ code: "google_backup_conflict" }));
    await controller.backupIdentity(PUBLIC_IDENTITY);
    controller.reset();
    await controller.backupIdentity(PUBLIC_IDENTITY);
    expect(MOCKS.requestAuthorization).toHaveBeenLastCalledWith(
      expect.any(AuthorizationPopup),
      undefined,
    );
  });

  it("continues a creation paused by the lifecycle with the same credentials", async () => {
    const controller = createController();
    const states = recordStates(controller);
    const partialCredentials = { ...CREDENTIALS, visibleBackupPermissionGranted: false };
    MOCKS.requestAuthorization.mockResolvedValue(Result.ok(partialCredentials));
    MOCKS.establishIdentity.mockResolvedValueOnce(
      Result.err({ code: "visible_backup_permission_missing" }),
    );

    expectResultError(await controller.establishIdentity(), {
      code: "visible_backup_permission_missing",
    });
    expect(MOCKS.establishIdentity).toHaveBeenCalledWith(
      partialCredentials,
      expect.any(Function),
      false,
    );
    expect(states.at(-1)).toEqual({
      status: "failed",
      error: { code: "visible_backup_permission_missing" },
    });

    const result = await controller.continueWithoutVisibleBackup();
    expect(Result.isOk(result)).toBe(true);
    expect(MOCKS.requestAuthorization).toHaveBeenCalledOnce();
    expect(MOCKS.establishIdentity).toHaveBeenLastCalledWith(
      partialCredentials,
      expect.any(Function),
      true,
    );
  });

  it("drops a pending partial grant when the user retries", async () => {
    const controller = createController();
    MOCKS.establishIdentity.mockResolvedValueOnce(
      Result.err({ code: "visible_backup_permission_missing" }),
    );
    MOCKS.requestAuthorization
      .mockResolvedValueOnce(Result.ok({ ...CREDENTIALS, visibleBackupPermissionGranted: false }))
      .mockResolvedValueOnce(Result.ok(CREDENTIALS));

    expectResultError(await controller.establishIdentity(), {
      code: "visible_backup_permission_missing",
    });
    await controller.establishIdentity();
    expectResultError(await controller.continueWithoutVisibleBackup(), {
      code: "operation_failed",
    });
    expect(MOCKS.requestAuthorization).toHaveBeenCalledTimes(2);
  });

  it.each([
    "establishIdentity",
    "replaceInvalidPassportFile",
    "replaceUndecryptablePassportFile",
  ] as const)(
    "renews expired credentials when continuing %s without prompting again",
    async (method) => {
      const controller = createController();
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);
      const partialCredentials = {
        ...CREDENTIALS,
        driveAccessTokenExpiresAt: now + 3_600_000,
        visibleBackupPermissionGranted: false,
      };
      const refreshedCredentials = {
        ...partialCredentials,
        driveAccessToken: "refreshed-access-token",
        driveAccessTokenExpiresAt: now + 10_800_000,
      };
      MOCKS.requestAuthorization
        .mockResolvedValueOnce(Result.ok(partialCredentials))
        .mockResolvedValueOnce(Result.ok(refreshedCredentials));
      MOCKS[method].mockResolvedValueOnce(
        Result.err({ code: "visible_backup_permission_missing" }),
      );

      await controller[method]();
      vi.mocked(Date.now).mockReturnValue(now + 7_200_000);
      expect(Result.isOk(await controller.continueWithoutVisibleBackup())).toBe(true);

      expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(
        2,
        expect.any(AuthorizationPopup),
        GOOGLE_ACCOUNT.googleSubject,
      );
      expect(MOCKS[method]).toHaveBeenLastCalledWith(
        refreshedCredentials,
        expect.any(Function),
        true,
      );
    },
  );

  it.each([null, Date.now() + 10_000])(
    "renews credentials with unknown or imminent expiry (%s)",
    async (driveAccessTokenExpiresAt) => {
      const controller = createController();
      MOCKS.requestAuthorization
        .mockResolvedValueOnce(
          Result.ok({
            ...CREDENTIALS,
            driveAccessTokenExpiresAt,
            visibleBackupPermissionGranted: false,
          }),
        )
        .mockResolvedValueOnce(Result.ok(CREDENTIALS));
      MOCKS.establishIdentity.mockResolvedValueOnce(
        Result.err({ code: "visible_backup_permission_missing" }),
      );

      await controller.establishIdentity();
      expect(Result.isOk(await controller.continueWithoutVisibleBackup())).toBe(true);
      expect(MOCKS.requestAuthorization).toHaveBeenCalledTimes(2);
      expect(MOCKS.establishIdentity).toHaveBeenLastCalledWith(
        CREDENTIALS,
        expect.any(Function),
        true,
      );
    },
  );

  it("rejects a different account when renewing paused credentials", async () => {
    const controller = createController();
    MOCKS.requestAuthorization
      .mockResolvedValueOnce(
        Result.ok({
          ...CREDENTIALS,
          driveAccessTokenExpiresAt: 0,
          visibleBackupPermissionGranted: false,
        }),
      )
      .mockResolvedValueOnce(
        Result.ok({
          ...CREDENTIALS,
          googleAccount: { ...GOOGLE_ACCOUNT, googleSubject: "different-account" },
        }),
      );
    MOCKS.establishIdentity.mockResolvedValueOnce(
      Result.err({ code: "visible_backup_permission_missing" }),
    );

    await controller.establishIdentity();
    expectResultError(await controller.continueWithoutVisibleBackup(), {
      code: "google_account_mismatch",
    });
    expect(MOCKS.establishIdentity).toHaveBeenCalledOnce();
  });

  it.each(["reset", "dispose"] as const)("clears paused credentials on %s", async (method) => {
    const controller = createController();
    MOCKS.requestAuthorization.mockResolvedValue(
      Result.ok({ ...CREDENTIALS, visibleBackupPermissionGranted: false }),
    );
    MOCKS.establishIdentity.mockResolvedValueOnce(
      Result.err({ code: "visible_backup_permission_missing" }),
    );
    await controller.establishIdentity();

    controller[method]();
    expectResultError(await controller.continueWithoutVisibleBackup(), {
      code: "operation_failed",
    });
    expect(MOCKS.establishIdentity).toHaveBeenCalledOnce();
  });

  it.each([
    "establish",
    "replace_invalid_passport_file",
    "replace_undecryptable_passport_file",
  ] as const)(
    "resumes %s after Google without a popup and preserves the backup choice",
    async (operation) => {
      const redirect = {
        request: vi.fn().mockResolvedValue(Result.ok(CREDENTIALS)),
        dispose: vi.fn(),
        takeContinuation: vi.fn().mockReturnValueOnce({
          operation,
          allowWithoutVisibleBackup: true,
          googleSubject: GOOGLE_ACCOUNT.googleSubject,
        }),
      };
      const controller = createController(redirect);
      const result = await controller.establishIdentity();
      expect(Result.isOk(result)).toBe(true);
      expect(window.open).not.toHaveBeenCalled();
      expect(MOCKS.requestAuthorization).not.toHaveBeenCalled();
      expect(redirect.request).toHaveBeenCalledWith({
        operation,
        allowWithoutVisibleBackup: true,
        googleSubject: GOOGLE_ACCOUNT.googleSubject,
      });
      const lifecycle =
        operation === "establish"
          ? MOCKS.establishIdentity
          : operation === "replace_invalid_passport_file"
            ? MOCKS.replaceInvalidPassportFile
            : MOCKS.replaceUndecryptablePassportFile;
      expect(lifecycle).toHaveBeenCalledWith(CREDENTIALS, expect.any(Function), true);
      expect(controller.getState().status).toBe("established");
      controller.dispose();
      expect(redirect.dispose).toHaveBeenCalledOnce();
    },
  );

  describe("with a request waiting (Google may go on in this window)", () => {
    /** The page that leaves for Google is destroyed, so its request never settles. */
    function waitingRedirect() {
      return {
        request: vi.fn(() => new Promise<never>(() => undefined)),
        dispose: vi.fn(),
        takeContinuation: vi.fn(),
      };
    }

    it("opens Google's own window by default, and does not leave this one", async () => {
      const redirect = waitingRedirect();
      const controller = createController(redirect);
      const states = recordStates(controller);

      const result = await controller.establishIdentity();

      expect(Result.isOk(result)).toBe(true);
      expect(window.open).toHaveBeenCalledOnce();
      expect(MOCKS.requestAuthorization).toHaveBeenCalledOnce();
      expect(redirect.request).not.toHaveBeenCalled();
      expect(states[0]).toEqual({ status: "requesting-authorization" });
      controller.dispose();
    });

    it.each<[string, () => Window | null]>([
      ["opens no window", () => null],
      ["hands back a window that is already closed", () => ({ closed: true }) as Window],
      [
        "refuses to open one",
        () => {
          throw new Error("No popups allowed");
        },
      ],
    ])("continues in this window when the browser blocks Google's: it %s", async (_case, open) => {
      vi.stubGlobal("open", vi.fn(open));
      const redirect = waitingRedirect();
      const controller = createController(redirect);
      const states = recordStates(controller);

      void controller.establishIdentity();

      await vi.waitFor(() =>
        expect(redirect.request).toHaveBeenCalledExactlyOnceWith({
          operation: "establish",
          allowWithoutVisibleBackup: false,
        }),
      );
      expect(MOCKS.requestAuthorization).not.toHaveBeenCalled();
      // The screen can say why the page is leaving.
      expect(states.at(-1)).toEqual({ status: "requesting-authorization", inThisTab: true });
      controller.dispose();
    });

    it("stays on the screen when the person closes Google's window: that is not a block", async () => {
      MOCKS.requestAuthorization.mockResolvedValueOnce(
        Result.err({ code: "google_authorization_popup_closed" as const }),
      );
      const redirect = waitingRedirect();
      const controller = createController(redirect);

      expectResultError(await controller.establishIdentity(), {
        code: "google_authorization_popup_closed",
      });

      expect(window.open).toHaveBeenCalledOnce();
      expect(redirect.request).not.toHaveBeenCalled();
      expect(controller.getState()).toEqual({
        status: "failed",
        error: { code: "google_authorization_popup_closed" },
      });
      controller.dispose();
    });

    it("does not leave either when Google's window ends in a denial or a failure", async () => {
      const redirect = waitingRedirect();
      const controller = createController(redirect);
      for (const code of ["google_authorization_denied", "google_authorization_failed"] as const) {
        MOCKS.requestAuthorization.mockResolvedValueOnce(Result.err({ code }));
        expectResultError(await controller.establishIdentity(), { code });
      }
      expect(redirect.request).not.toHaveBeenCalled();
      controller.dispose();
    });

    it("asks for the blocked window to be allowed when this one could not leave either", async () => {
      vi.stubGlobal(
        "open",
        vi.fn(() => null),
      );
      const redirect = {
        ...waitingRedirect(),
        request: vi
          .fn()
          .mockResolvedValue(Result.err({ code: "google_authorization_failed" as const })),
      };
      const controller = createController(redirect);

      expectResultError(await controller.establishIdentity(), {
        code: "google_authorization_popup_failed_to_open",
      });
      expect(controller.getState()).toEqual({
        status: "failed",
        error: { code: "google_authorization_popup_failed_to_open" },
      });
      controller.dispose();
    });

    it("never leaves this window for a detachment or a backup, blocked or not", async () => {
      vi.stubGlobal(
        "open",
        vi.fn(() => null),
      );
      const redirect = waitingRedirect();
      const controller = createController(redirect);

      expectResultError(
        await controller.detachIdentity(PUBLIC_IDENTITY, GOOGLE_ACCOUNT.googleSubject),
        { code: "google_authorization_popup_failed_to_open" },
      );
      expectResultError(await controller.backupIdentity(PUBLIC_IDENTITY), {
        code: "google_authorization_popup_failed_to_open",
      });
      expect(redirect.request).not.toHaveBeenCalled();
      controller.dispose();
    });

    it("takes Google's answer in this window once: a later attempt opens Google's window again", async () => {
      const redirect = {
        request: vi
          .fn()
          .mockResolvedValue(Result.err({ code: "google_authorization_denied" as const })),
        dispose: vi.fn(),
        takeContinuation: vi
          .fn()
          .mockReturnValueOnce({ operation: "establish", allowWithoutVisibleBackup: false }),
      };
      const controller = createController(redirect);
      const states = recordStates(controller);

      expectResultError(await controller.establishIdentity(), {
        code: "google_authorization_denied",
      });
      expect(window.open).not.toHaveBeenCalled();
      expect(states).toContainEqual({ status: "requesting-authorization", inThisTab: true });

      // Try again is a new press: Google's own window first, as everywhere.
      expect(Result.isOk(await controller.establishIdentity())).toBe(true);
      expect(window.open).toHaveBeenCalledOnce();
      expect(redirect.request).toHaveBeenCalledOnce();
      controller.dispose();
    });
  });

  it("rejects a different Google account when resuming a confirmed replacement", async () => {
    const redirect = {
      request: vi.fn().mockResolvedValue(Result.ok(CREDENTIALS)),
      dispose: vi.fn(),
      takeContinuation: vi.fn().mockReturnValueOnce({
        operation: "replace_invalid_passport_file",
        allowWithoutVisibleBackup: true,
        googleSubject: "another-account",
      }),
    };
    const controller = createController(redirect);
    expectResultError(await controller.establishIdentity(), { code: "google_account_mismatch" });
    expect(MOCKS.replaceInvalidPassportFile).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("cancels a waiting authorization at the person's request and starts over", async () => {
    const popup = createPopupWindow();
    vi.stubGlobal(
      "open",
      vi.fn(() => popup.window),
    );
    let settleRequest: (result: unknown) => void = () => undefined;
    MOCKS.requestAuthorization.mockImplementationOnce(
      () => new Promise((resolve) => (settleRequest = resolve)),
    );
    // The implicit authorization settles a cancelled request as failed.
    MOCKS.cancelAuthorization.mockImplementation(() =>
      settleRequest(
        Result.err({ code: "google_authorization_failed", reason: "authorization_cancelled" }),
      ),
    );
    const controller = createController();
    const states = recordStates(controller);

    const pending = controller.establishIdentity();
    await vi.waitFor(() => expect(MOCKS.requestAuthorization).toHaveBeenCalledOnce());
    controller.showAuthorizationWindow();
    expect(popup.focus).toHaveBeenCalledOnce();
    controller.cancelAuthorization();

    expectResultError(await pending, { code: "cancelled" });
    expect(popup.close).toHaveBeenCalled();
    expect(MOCKS.cancelAuthorization).toHaveBeenCalledOnce();
    expect(MOCKS.establishIdentity).not.toHaveBeenCalled();
    expect(states).toEqual([{ status: "requesting-authorization" }, { status: "idle" }]);

    // The next operation starts normally, and Show and Cancel no longer reach the old window.
    controller.showAuthorizationWindow();
    controller.cancelAuthorization();
    expect(popup.focus).toHaveBeenCalledOnce();
    expect(MOCKS.cancelAuthorization).toHaveBeenCalledOnce();
    await controller.establishIdentity();
    expect(controller.getState()).toMatchObject({ status: "established" });
  });

  it("forgets the Google account of an operation cancelled while retrying", async () => {
    let settleRequest: (result: unknown) => void = () => undefined;
    MOCKS.cancelAuthorization.mockImplementation(() =>
      settleRequest(
        Result.err({ code: "google_authorization_failed", reason: "authorization_cancelled" }),
      ),
    );
    MOCKS.establishIdentity.mockResolvedValueOnce(Result.err({ code: "drive_read_failed" }));
    const controller = createController();
    await controller.establishIdentity();
    expect(MOCKS.requestAuthorization).toHaveBeenLastCalledWith(expect.anything(), undefined);

    MOCKS.requestAuthorization.mockImplementationOnce(
      () => new Promise((resolve) => (settleRequest = resolve)),
    );
    const retry = controller.establishIdentity();
    await vi.waitFor(() => expect(MOCKS.requestAuthorization).toHaveBeenCalledTimes(2));
    // A retry asks Google for the account that already answered.
    expect(MOCKS.requestAuthorization).toHaveBeenLastCalledWith(
      expect.anything(),
      GOOGLE_ACCOUNT.googleSubject,
    );
    controller.cancelAuthorization();
    expectResultError(await retry, { code: "cancelled" });
    expect(controller.getState()).toEqual({ status: "idle" });

    await controller.establishIdentity();
    expect(MOCKS.requestAuthorization).toHaveBeenLastCalledWith(expect.anything(), undefined);
  });

  it("cancels while its dependencies load, before Google's page opens", async () => {
    const popup = createPopupWindow();
    vi.stubGlobal(
      "open",
      vi.fn(() => popup.window),
    );
    const controller = createController();
    const states = recordStates(controller);

    const pending = controller.establishIdentity();
    // Still before the first await: the lazy imports have not resolved.
    controller.cancelAuthorization();

    expectResultError(await pending, { code: "cancelled" });
    expect(popup.close).toHaveBeenCalled();
    expect(popup.replace).not.toHaveBeenCalled();
    expect(MOCKS.requestAuthorization).not.toHaveBeenCalled();
    expect(states).toEqual([{ status: "requesting-authorization" }, { status: "idle" }]);
  });

  it("does not cancel work that already holds Google credentials", async () => {
    let finishLookup: (result: unknown) => void = () => undefined;
    MOCKS.establishIdentity.mockImplementationOnce(
      () => new Promise((resolve) => (finishLookup = resolve)),
    );
    const controller = createController();

    const pending = controller.establishIdentity();
    await vi.waitFor(() => expect(MOCKS.establishIdentity).toHaveBeenCalledOnce());
    controller.cancelAuthorization();
    expect(MOCKS.cancelAuthorization).not.toHaveBeenCalled();
    finishLookup(
      Result.ok({ establishmentMode: "restored" as const, publicIdentity: PUBLIC_IDENTITY }),
    );

    expect(Result.isOk(await pending)).toBe(true);
    expect(controller.getState()).toMatchObject({ status: "established" });
  });

  it("composes and disposes its real screen-scoped dependencies", () => {
    const session = new GoogleIdentityController("google-client-id", "https://homegate.example/");
    expect(() => session.dispose()).not.toThrow();
  });

  it("opens the consent popup synchronously, before loading its dependencies", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const popup = createPopupWindow();
    const open = vi.fn(() => popup.window);
    vi.stubGlobal("open", open);
    const controller = new GoogleIdentityController(
      "google-client-id",
      "https://homegate.example/",
    );

    const pending = controller.establishIdentity();
    // Still inside the caller's task: no await has run, so a click's activation still applies.
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "about:blank",
      expect.stringMatching(/^pubky-passport-google-/u),
      "popup,width=520,height=680",
    );
    controller.dispose();

    expectResultError(await pending, { code: "cancelled" });
    expect(popup.close).toHaveBeenCalledOnce();
    expect(popup.replace).not.toHaveBeenCalled();
  });

  it("runs the real authorization and lifecycle constructors when no factories are injected", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const popup = createPopupWindow();
    vi.stubGlobal(
      "open",
      vi.fn(() => popup.window),
    );
    const controller = new GoogleIdentityController(
      "google-client-id",
      "https://homegate.example/",
    );

    const pending = controller.establishIdentity();
    await vi.waitFor(() => expect(popup.replace).toHaveBeenCalledOnce());
    expect(new URL(String(popup.replace.mock.calls[0]?.[0])).origin).toBe(
      "https://accounts.google.com",
    );
    controller.dispose();

    expectResultError(await pending, { code: "cancelled" });
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it("lets a single injected factory replace only its own constructor", async () => {
    const popup = createPopupWindow();
    vi.stubGlobal(
      "open",
      vi.fn(() => popup.window),
    );
    const controller = new GoogleIdentityController(
      "google-client-id",
      "https://homegate.example/",
      undefined,
      () => ({
        abortRequests: MOCKS.abortRequests,
        detachIdentity: MOCKS.detachIdentity,
        backupIdentity: MOCKS.backupIdentity,
        dispose: MOCKS.disposeLifecycle,
        establishIdentity: MOCKS.establishIdentity,
        replaceInvalidPassportFile: MOCKS.replaceInvalidPassportFile,
        replaceUndecryptablePassportFile: MOCKS.replaceUndecryptablePassportFile,
      }),
    );
    const states = recordStates(controller);
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);

    const pending = controller.establishIdentity();
    await vi.waitFor(() => expect(popup.replace).toHaveBeenCalledOnce());
    controller.dispose();

    expectResultError(await pending, { code: "cancelled" });
    expect(MOCKS.establishIdentity).not.toHaveBeenCalled();
    expect(MOCKS.disposeLifecycle).toHaveBeenCalledOnce();
    expect(states).toEqual([{ status: "requesting-authorization" }]);
  });

  it("reports a blocked popup without loading authorization and stays retryable", async () => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const open = vi.fn(() => null);
    vi.stubGlobal("open", open);
    const controller = createController();
    const states = recordStates(controller);

    expectResultError(await controller.establishIdentity(), {
      code: "google_authorization_popup_failed_to_open",
    });
    expect(open).toHaveBeenCalledOnce();
    expect(MOCKS.requestAuthorization).not.toHaveBeenCalled();
    expect(MOCKS.establishIdentity).not.toHaveBeenCalled();
    expect(states).toEqual([
      { status: "requesting-authorization" },
      { status: "failed", error: { code: "google_authorization_popup_failed_to_open" } },
    ]);

    vi.stubGlobal(
      "open",
      vi.fn(() => createPopupWindow().window),
    );
    expect(Result.isOk(await controller.establishIdentity())).toBe(true);
  });

  it("closes the pending popup when its dependencies fail to construct", async () => {
    vi.spyOn(LOGGER, "error").mockImplementation(() => undefined);
    const popup = createPopupWindow();
    vi.stubGlobal(
      "open",
      vi.fn(() => popup.window),
    );
    const controller = new GoogleIdentityController(
      "google-client-id",
      "https://homegate.example/",
      () => ({
        request: MOCKS.requestAuthorization,
        cancel: MOCKS.cancelAuthorization,
        dispose: MOCKS.disposeAuthorization,
      }),
      () => {
        throw new Error("lifecycle construction failed");
      },
    );

    expectResultError(await controller.establishIdentity(), { code: "operation_failed" });
    expect(popup.close).toHaveBeenCalledOnce();
    expect(popup.replace).not.toHaveBeenCalled();
    expect(MOCKS.requestAuthorization).not.toHaveBeenCalled();
    expect(MOCKS.disposeAuthorization).toHaveBeenCalledOnce();
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
    expect(MOCKS.establishIdentity).toHaveBeenCalledWith(CREDENTIALS, expect.any(Function), false);
  });

  it("publishes only the allowlisted established fields", async () => {
    MOCKS.establishIdentity.mockResolvedValue(
      Result.ok({
        establishmentMode: "restored" as const,
        publicIdentity: PUBLIC_IDENTITY,
        secret: "ESTABLISHED-PAYLOAD-CANARY",
      }),
    );
    const controller = createController();
    const states = recordStates(controller);

    const established = await controller.establishIdentity();

    expect(JSON.stringify(controller.getState())).not.toContain("ESTABLISHED-PAYLOAD-CANARY");
    expect(JSON.stringify(states)).not.toContain("ESTABLISHED-PAYLOAD-CANARY");
    expect(JSON.stringify(established)).not.toContain("ESTABLISHED-PAYLOAD-CANARY");
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

    expect(states).toEqual([
      { status: "requesting-authorization" },
      { status: "establishing", progress: { flow: "repair", step: "signing_up" } },
      { status: "establishing", progress: { flow: "repair", step: "publishing" } },
      { status: "establishing", progress: { flow: "repair", step: "signing_in" } },
      {
        status: "established",
        identity: {
          establishmentMode: "restored",
          googleAccount: GOOGLE_ACCOUNT,
          publicIdentity: PUBLIC_IDENTITY,
        },
      },
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
      { code: "google_account_mismatch" },
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

    expectResultError(await controller.establishIdentity(), { code: "google_account_mismatch" });

    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(
      1,
      expect.any(AuthorizationPopup),
      undefined,
    );
    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(
      2,
      expect.any(AuthorizationPopup),
      GOOGLE_ACCOUNT.googleSubject,
    );
    expect(MOCKS.establishIdentity).toHaveBeenCalledOnce();
  });

  it("allows a new establishment flow to choose another Google account", async () => {
    const controller = createController();
    await controller.establishIdentity();

    controller.reset();
    await controller.establishIdentity();

    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(
      1,
      expect.any(AuthorizationPopup),
      undefined,
    );
    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(
      2,
      expect.any(AuthorizationPopup),
      undefined,
    );
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
      flow: "repair" as const,
      cause: diagnosticCanary,
    };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.establishIdentity.mockResolvedValue(Result.err(operationError));

    const result = await createController().establishIdentity();

    expectResultError(result, {
      code: "homeserver_signup_token_failed",
      detailCode: "weekly_limit_exceeded",
      flow: "repair",
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

    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(
      2,
      expect.any(AuthorizationPopup),
      GOOGLE_ACCOUNT.googleSubject,
    );
    expect(MOCKS.replaceInvalidPassportFile).toHaveBeenCalledWith(
      CREDENTIALS,
      expect.any(Function),
      false,
    );
  });

  it("replaces an undecryptable file with the pinned Google account and returns the created identity", async () => {
    const controller = createController();
    MOCKS.establishIdentity.mockResolvedValueOnce(Result.err({ code: "decrypt_failed" as const }));
    await controller.establishIdentity();

    await expect(controller.replaceUndecryptablePassportFile()).resolves.toEqual(
      Result.ok({
        establishmentMode: "created",
        googleAccount: GOOGLE_ACCOUNT,
        publicIdentity: PUBLIC_IDENTITY,
        visibleRecoveryCopyStatus: "created",
      }),
    );

    expect(MOCKS.requestAuthorization).toHaveBeenNthCalledWith(
      2,
      expect.any(AuthorizationPopup),
      GOOGLE_ACCOUNT.googleSubject,
    );
    expect(MOCKS.replaceUndecryptablePassportFile).toHaveBeenCalledWith(
      CREDENTIALS,
      expect.any(Function),
      false,
    );
    expect(MOCKS.replaceInvalidPassportFile).not.toHaveBeenCalled();
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
      code: "google_account_mismatch",
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

/** A blank popup window as `window.open` hands it to the controller. */
function createPopupWindow() {
  const close = vi.fn();
  const focus = vi.fn();
  const replace = vi.fn();
  const window = { closed: false, close, focus, location: { replace } } as unknown as Window;
  return { window, close, focus, replace };
}

function recordStates(controller: GoogleIdentityController): GoogleIdentityViewState[] {
  const states: GoogleIdentityViewState[] = [];
  controller.subscribe((state) => states.push(state));
  return states;
}

function createController(
  redirect?: ConstructorParameters<typeof GoogleIdentityController>[4],
): GoogleIdentityController {
  return new GoogleIdentityController(
    "google-client-id",
    "https://homegate.example/",
    () => ({
      request: MOCKS.requestAuthorization,
      cancel: MOCKS.cancelAuthorization,
      dispose: MOCKS.disposeAuthorization,
    }),
    () => ({
      abortRequests: MOCKS.abortRequests,
      detachIdentity: MOCKS.detachIdentity,
      backupIdentity: MOCKS.backupIdentity,
      dispose: MOCKS.disposeLifecycle,
      establishIdentity: MOCKS.establishIdentity,
      replaceInvalidPassportFile: MOCKS.replaceInvalidPassportFile,
      replaceUndecryptablePassportFile: MOCKS.replaceUndecryptablePassportFile,
    }),
    redirect,
  );
}
