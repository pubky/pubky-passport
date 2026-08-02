/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { LOGGER } from "../../libs/logger/logger";
import {
  type PassportIdentityControllerError,
  PassportIdentityController,
  type PassportIdentityControllerDependencies,
} from "./passportIdentityController";
import type { GoogleSignInResult } from "../google-sign-in/googleIdentityServicesSignInButton";
import type { GoogleBackedIdentityProgress } from "./google-backed/googleBackedIdentityProgress";

const GOOGLE_SUBJECT_CANARY = "google-subject";

describe("PassportIdentityController", () => {
  afterEach(() => vi.restoreAllMocks());

  it("exposes a finite action error code contract", () => {
    expectTypeOf<PassportIdentityControllerError["code"]>().not.toEqualTypeOf<string>();
    expectTypeOf<GoogleBackedIdentityProgress>().not.toEqualTypeOf<string>();
  });

  it.each(["list", "select", "clear"] as const)("logs unexpected %s catalog exceptions without identity details", (operation) => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const controller = new PassportIdentityController(dependencies({
      [operation]: () => { throw new Error("SECRET-IDENTITY-ID"); },
    }));

    const result = operation === "list"
      ? controller.list()
      : operation === "select"
        ? controller.select("SECRET-IDENTITY-ID")
        : controller.clear();

    expect((result as { error?: { code: string } }).error).toEqual({ code: "storage_unavailable" });
    expect(warning).toHaveBeenCalledWith("identity.local_catalog.failed", {
      operation,
      code: "runtime_exception",
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-IDENTITY-ID");
  });

  it("contains sign-in cleanup exceptions and continues identity operation disposal", () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const disposeGoogleBackedIdentityOperations = vi.fn();
    const controller = new PassportIdentityController(dependencies({
      unmountGoogleSignIn: () => { throw new Error("SECRET-GOOGLE-TOKEN"); },
      disposeGoogleBackedIdentityOperations,
    }));

    expect(() => controller.dispose()).not.toThrow();

    expect(disposeGoogleBackedIdentityOperations).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith("identity.google.cleanup.failed", {
      operation: "google_sign_in_unmount",
      code: "cleanup_failed",
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-GOOGLE-TOKEN");
  });

  it.each(["subscribe", "unsubscribe"] as const)("logs and surfaces sanitized %s failures", (operation) => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const controller = new PassportIdentityController(dependencies({
      subscribe: operation === "subscribe"
        ? () => { throw new Error("SECRET-SUBSCRIPTION-CANARY"); }
        : () => () => { throw new Error("SECRET-SUBSCRIPTION-CANARY"); },
    }));

    if (operation === "subscribe") {
      expect(() => controller.subscribe(vi.fn())).toThrow("Identity subscription unavailable.");
    } else {
      const unsubscribe = controller.subscribe(vi.fn());
      expect(() => unsubscribe()).toThrow("Identity subscription cleanup failed.");
    }
    expect(warning).toHaveBeenCalledWith("identity.local_catalog.failed", {
      operation,
      code: "runtime_exception",
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET-SUBSCRIPTION-CANARY");
  });

  it("keeps Google credentials private and returns a safe established identity", async () => {
    const states: unknown[] = [];
    const establish = establishmentDouble(async (reportProgress) => {
      reportProgress("checking_passport_file");
      reportProgress("restoring_identity");
      reportProgress("activating_restored_identity");
      return Result.ok({
        establishmentMode: "restored" as const,
        publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
      });
    });
    const requestGoogleDriveAccess = driveAccessDouble(async () => {
      expect(states.at(-1)).toEqual({ stage: "requesting-google-drive-authorization" });
      return Result.ok("drive-access-token");
    });
    const { controller, credentialCallback } = await mountedController({
      restoreOrCreateGoogleBackedIdentity: establish.execute,
      requestGoogleDriveAccess: requestGoogleDriveAccess.execute,
    }, states);

    credentialCallback.current?.(googleCredential());
    const completed = await controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" });

    expect(requestGoogleDriveAccess.record).toEqual({
      calls: 1,
      subjectPresent: true,
      matchesExpectedSubject: true,
      hasSignal: true,
    });
    expect(JSON.stringify(requestGoogleDriveAccess.record)).not.toContain(GOOGLE_SUBJECT_CANARY);
    expect(establish.calls).toBe(1);
    expect(states).toEqual([
      { stage: "google-sign-in", errorCode: null },
      { stage: "google-drive-authorization" },
      { stage: "requesting-google-drive-authorization" },
      { stage: "establishing-google-backed-identity", progress: "checking_passport_file" },
      { stage: "establishing-google-backed-identity", progress: "restoring_identity" },
      { stage: "establishing-google-backed-identity", progress: "activating_restored_identity" },
      { stage: "google-sign-in", errorCode: null },
    ]);
    expect(establish.receivedExpectedCredentials).toBe(true);
    expect(completed).toEqual({
      status: "action_completed",
      result: Result.ok({
        kind: "google_backed_identity_established",
        establishmentMode: "restored",
        publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
      }),
    });
    expect("keyHandle" in (completed.status === "action_completed" && !Result.isError(completed.result) ? completed.result.value : {})).toBe(false);
    expect(JSON.stringify(states)).not.toContain("google-id-token");
    expect(JSON.stringify(states)).not.toContain("drive-access-token");
  });

  it.each(["created", "unconfirmed"] as const)("propagates the created visible-copy %s status", async (status) => {
    const establish = establishmentDouble(async () => Result.ok({
      establishmentMode: "created" as const,
      publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
      visibleRecoveryCopyStatus: status,
    }));
    const { controller, credentialCallback } = await mountedController({
      restoreOrCreateGoogleBackedIdentity: establish.execute,
    });
    credentialCallback.current?.(googleCredential());

    const completed = await controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" });

    expect(completed.status).toBe("action_completed");
    if (completed.status !== "action_completed") throw new Error("Expected completed action");
    expect(completed.result).toEqual(Result.ok({
      kind: "google_backed_identity_established",
      establishmentMode: "created",
      publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
      visibleRecoveryCopyStatus: status,
    }));
  });

  it.each([
    "invalid_google_id_token",
    "weekly_limit_exceeded",
    "annual_limit_exceeded",
    "homegate_invalid_request",
    "homeserver_unavailable",
    "google_verifier_unavailable",
    "homegate_unavailable",
    "malformed_homegate_response",
    "network_failed",
  ] as const)("translates the Homegate %s cause for UI consumers", async (cause) => {
    const establish = establishmentDouble(async () => Result.err({
      code: "homeserver_signup_invitation_failed" as const,
      cause,
    }));
    const { controller, credentialCallback } = await mountedController({
      restoreOrCreateGoogleBackedIdentity: establish.execute,
    });
    credentialCallback.current?.(googleCredential());

    const completed = await controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" });

    expect(completed.status).toBe("action_completed");
    if (completed.status !== "action_completed") throw new Error("Expected completed action");
    expect(Result.isError(completed.result)).toBe(true);
    if (Result.isError(completed.result)) {
      expect(completed.result.error).toEqual({ code: cause });
    }
  });

  it.each([
    ["invalid_google_id_token", "invalid_google_id_token"],
    ["rate_limited", "wrapping_key_rate_limited"],
    ["dependency_unavailable", "wrapping_key_unavailable"],
    ["internal_error", "wrapping_key_unavailable"],
    ["network_failed", "wrapping_key_unavailable"],
    ["invalid_request", "wrapping_key_failed"],
    ["invalid_response", "wrapping_key_failed"],
  ] as const)("translates the wrapping-key %s cause for UI consumers", async (cause, expectedCode) => {
    const establish = establishmentDouble(async () => Result.err({
      code: "wrapping_key_failed" as const,
      cause,
    }));
    const { controller, credentialCallback } = await mountedController({
      restoreOrCreateGoogleBackedIdentity: establish.execute,
    });
    credentialCallback.current?.(googleCredential());

    const completed = await controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" });

    expect(completed.status).toBe("action_completed");
    if (completed.status !== "action_completed") throw new Error("Expected completed action");
    expect(Result.isError(completed.result)).toBe(true);
    if (Result.isError(completed.result)) {
      expect(completed.result.error).toEqual({ code: expectedCode });
    }
  });

  it("translates wrapping-key causes from Drive Passport file deletion", async () => {
    const execute = deletionDouble(async () => Result.err({
      code: "wrapping_key_failed" as const,
      cause: "rate_limited" as const,
    }));
    const { controller, credentialCallback } = await mountedController({
      deleteGoogleDrivePassportFile: execute.execute,
    });
    credentialCallback.current?.(googleCredential());

    const completed = await controller.continueGoogleBackedIdentityAction({
      kind: "delete_google_drive_passport_file",
      expectedPublicKeyZ32: "public-key",
    });

    expect(completed.status).toBe("action_completed");
    if (completed.status !== "action_completed") throw new Error("Expected completed action");
    expect(Result.isError(completed.result)).toBe(true);
    if (Result.isError(completed.result)) {
      expect(completed.result.error).toEqual({ code: "wrapping_key_rate_limited" });
    }
  });

  it("account-matches Drive access and exposes only safe Google state", async () => {
    const states: unknown[] = [];
    const requestGoogleDriveAccess = driveAccessDouble(async () => Result.err({ code: "google_drive_authorization_account_mismatch" as const }));
    const { controller, credentialCallback } = await mountedController({
      requestGoogleDriveAccess: requestGoogleDriveAccess.execute,
    }, states);

    credentialCallback.current?.(googleCredential());
    const completed = await controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" });

    expect(completed).toEqual({ status: "google_authorization_failed" });
    expect(states).toContainEqual({ stage: "google-drive-authorization" });
    expect(states).toContainEqual({
      stage: "google-sign-in",
      errorCode: "google_drive_authorization_account_mismatch",
    });
    expect(JSON.stringify(states)).not.toContain("google-id-token");
    expect(JSON.stringify(requestGoogleDriveAccess.record)).not.toContain(GOOGLE_SUBJECT_CANARY);
  });

  it("aborts pending Drive acquisition and ignores its result after unmount", async () => {
    let resolveDrive: ((value: ReturnType<typeof Result.ok<string>>) => void) | undefined;
    let driveSignal: AbortSignal | undefined;
    const establish = establishmentDouble(async () => Result.err({ code: "unexpected_failure" as const }));
    const requestGoogleDriveAccess = (_googleSubject: string, signal: AbortSignal) => {
      driveSignal = signal;
      return new Promise<ReturnType<typeof Result.ok<string>>>((resolve) => { resolveDrive = resolve; });
    };
    const { controller, credentialCallback } = await mountedController({
      restoreOrCreateGoogleBackedIdentity: establish.execute,
      requestGoogleDriveAccess,
    });
    credentialCallback.current?.(googleCredential());

    const pending = controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" });
    controller.unmountGoogleSignIn();
    resolveDrive?.(Result.ok("late-drive-token"));

    await expect(pending).resolves.toEqual({ status: "superseded" });
    expect(driveSignal?.aborted).toBe(true);
    expect(establish.calls).toBe(0);
  });

  it.each([
    ["throw", vi.fn(async () => { throw new Error("mount failed"); })],
    ["error", vi.fn(async () => Result.err({ code: "google_unavailable" as const }))],
  ])("maps a Google widget mount %s to safe state", async (_operation, mount) => {
    const states: unknown[] = [];
    const controller = new PassportIdentityController(
      dependencies({ mountGoogleSignIn: mount, unmountGoogleSignIn: vi.fn() }),
    );

    await expect(controller.mountGoogleSignIn(document.createElement("div"), (state) => states.push(state))).resolves.toBeUndefined();

    expect(states.at(-1)).toEqual({
      stage: "google-sign-in",
      errorCode: "sign_in_unavailable",
    });
  });

  it("unmounts a failed widget and retries initialization", async () => {
    const mount = vi.fn()
      .mockResolvedValueOnce(Result.err({ code: "google_unavailable" as const }))
      .mockResolvedValueOnce(Result.ok());
    const unmount = vi.fn();
    const states: unknown[] = [];
    const controller = new PassportIdentityController(
      dependencies({ mountGoogleSignIn: mount, unmountGoogleSignIn: unmount }),
    );

    await controller.mountGoogleSignIn(document.createElement("div"), (state) => states.push(state));
    expect(unmount).toHaveBeenCalled();

    controller.retryGoogleSignIn();
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2));

    expect(states.at(-1)).toEqual({ stage: "google-sign-in", errorCode: null });
  });

  it("maps thrown Drive acquisition to credential failure without rejecting", async () => {
    const states: unknown[] = [];
    const { controller, credentialCallback } = await mountedController({
      requestGoogleDriveAccess: async () => { throw new Error("Drive failed"); },
    }, states);
    credentialCallback.current?.(googleCredential());

    await expect(controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" })).resolves.toEqual({ status: "google_authorization_failed" });
    expect(states.at(-1)).toEqual({
      stage: "google-sign-in",
      errorCode: "google_drive_authorization_failed",
    });
  });

  it("maps thrown identity actions to an unexpected failure result", async () => {
    const { controller, credentialCallback } = await mountedController({
      deleteGoogleDrivePassportFile: async () => { throw new Error("delete failed"); },
    });
    credentialCallback.current?.(googleCredential());

    const completed = await controller.continueGoogleBackedIdentityAction({
      kind: "delete_google_drive_passport_file",
      expectedPublicKeyZ32: "public-key",
    });
    expect(completed.status).toBe("action_completed");
    if (completed.status !== "action_completed") throw new Error("Expected action result");
    expect(Result.isError(completed.result)).toBe(true);
    if (!Result.isError(completed.result)) throw new Error("Expected action failure");
    expect(completed.result.error).toEqual({ code: "unexpected_failure" });
  });

  it("runs Google continuation single-flight without reusing credentials", async () => {
    let resolveDrive: ((value: ReturnType<typeof Result.ok<string>>) => void) | undefined;
    const requestGoogleDriveAccess = driveAccessDouble(() => new Promise<ReturnType<typeof Result.ok<string>>>((resolve) => {
      resolveDrive = resolve;
    }));
    const establish = establishmentDouble(async () => Result.err({ code: "unexpected_failure" as const }));
    const { controller, credentialCallback } = await mountedController({
      requestGoogleDriveAccess: requestGoogleDriveAccess.execute,
      restoreOrCreateGoogleBackedIdentity: establish.execute,
    });
    credentialCallback.current?.(googleCredential());

    const first = controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" });
    await expect(controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" })).resolves.toEqual({ status: "busy" });
    resolveDrive?.(Result.ok("drive-access-token"));
    await first;

    await expect(controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" })).resolves.toEqual({ status: "google_authorization_failed" });

    expect(requestGoogleDriveAccess.record.calls).toBe(1);
    expect(establish.calls).toBe(1);
  });

  it("defers one-time identity action disposal and suppresses completion after dispose", async () => {
    let resolveEstablish: ((value: ReturnType<typeof Result.ok<{
      establishmentMode: "restored";
      publicIdentity: { publicKeyZ32: string; publicKeyDisplay: string };
    }>>) => void) | undefined;
    const disposeGoogleBackedIdentityOperations = vi.fn();
    const establish = establishmentDouble(
      () => new Promise((resolve) => { resolveEstablish = resolve; }),
    );
    const { controller, credentialCallback } = await mountedController({
      restoreOrCreateGoogleBackedIdentity: establish.execute,
      disposeGoogleBackedIdentityOperations,
    });
    credentialCallback.current?.(googleCredential());

    const pending = controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" });
    await vi.waitFor(() => expect(establish.calls).toBe(1));
    controller.dispose();
    controller.dispose();
    expect(disposeGoogleBackedIdentityOperations).not.toHaveBeenCalled();
    resolveEstablish?.(Result.ok({
      establishmentMode: "restored",
      publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
    }));

    const completed = await pending;
    expect(completed.status).toBe("action_finished_after_unmount");
    if (completed.status !== "action_finished_after_unmount") throw new Error("Expected superseded action result");
    expect(Result.isError(completed.result)).toBe(false);
    expect(disposeGoogleBackedIdentityOperations).toHaveBeenCalledOnce();
  });

  it("preserves a failed establishment result after ordinary unmount", async () => {
    const establishment = deferred<Awaited<ReturnType<PassportIdentityControllerDependencies["restoreOrCreateGoogleBackedIdentity"]>>>();
    const establish = establishmentDouble(() => establishment.promise);
    const { controller, credentialCallback } = await mountedController({ restoreOrCreateGoogleBackedIdentity: establish.execute });
    credentialCallback.current?.(googleCredential());

    const pending = controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" });
    await vi.waitFor(() => expect(establish.calls).toBe(1));
    controller.unmountGoogleSignIn();
    establishment.resolve(Result.err({
      code: "signup_failed",
      warning: "visible_recovery_copy_unconfirmed",
    }));

    const completed = await pending;
    expect(completed.status).toBe("action_finished_after_unmount");
    if (completed.status !== "action_finished_after_unmount") throw new Error("Expected unmounted action result");
    expect(Result.isError(completed.result)).toBe(true);
    if (Result.isError(completed.result)) expect(completed.result.error).toEqual({
      code: "signup_failed",
      warning: "visible_recovery_copy_unconfirmed",
    });
    controller.dispose();
  });

  it("suppresses progress from an operation after unmount and remount", async () => {
    const establishment = deferred<Awaited<ReturnType<PassportIdentityControllerDependencies["restoreOrCreateGoogleBackedIdentity"]>>>();
    let reportProgress: Parameters<PassportIdentityControllerDependencies["restoreOrCreateGoogleBackedIdentity"]>[1] | undefined;
    const establish = establishmentDouble((report) => {
      reportProgress = report;
      return establishment.promise;
    });
    const oldStates: unknown[] = [];
    const { controller, credentialCallback } = await mountedController({
      restoreOrCreateGoogleBackedIdentity: establish.execute,
    }, oldStates);
    credentialCallback.current?.(googleCredential());

    const pending = controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" });
    await vi.waitFor(() => expect(reportProgress).toBeDefined());
    controller.unmountGoogleSignIn();
    const newStates: unknown[] = [];
    await controller.mountGoogleSignIn(document.createElement("div"), (state) => newStates.push(state));
    reportProgress?.("restoring_identity");

    expect(oldStates).not.toContainEqual({ stage: "establishing-google-backed-identity", progress: "restoring_identity" });
    expect(newStates).not.toContainEqual({ stage: "establishing-google-backed-identity", progress: "restoring_identity" });
    establishment.resolve(Result.err({ code: "unexpected_failure" }));
    await pending;
    controller.dispose();
  });

  it("suppresses retained progress callbacks after an action completes", async () => {
    let reportProgress: Parameters<PassportIdentityControllerDependencies["restoreOrCreateGoogleBackedIdentity"]>[1] | undefined;
    const establish = establishmentDouble(async (report) => {
      reportProgress = report;
      report("checking_passport_file");
      return Result.ok({
        establishmentMode: "restored",
        publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
      });
    });
    const states: unknown[] = [];
    const { controller, credentialCallback } = await mountedController({
      restoreOrCreateGoogleBackedIdentity: establish.execute,
    }, states);
    credentialCallback.current?.(googleCredential());

    await controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" });
    const statesAfterCompletion = states.length;
    reportProgress?.("restoring_identity");

    expect(states).toHaveLength(statesAfterCompletion);
    controller.dispose();
  });

  it("preserves a successful deletion result after ordinary unmount", async () => {
    const deletion = deferred<Awaited<ReturnType<PassportIdentityControllerDependencies["deleteGoogleDrivePassportFile"]>>>();
    const execute = deletionDouble(() => deletion.promise);
    const { controller, credentialCallback } = await mountedController({ deleteGoogleDrivePassportFile: execute.execute });
    credentialCallback.current?.(googleCredential());

    const pending = controller.continueGoogleBackedIdentityAction({ kind: "delete_google_drive_passport_file", expectedPublicKeyZ32: "public-key" });
    await vi.waitFor(() => expect(execute.calls).toBe(1));
    controller.unmountGoogleSignIn();
    deletion.resolve(Result.ok({ status: "deleted" }));

    const completed = await pending;
    expect(completed.status).toBe("action_finished_after_unmount");
    if (completed.status !== "action_finished_after_unmount") throw new Error("Expected unmounted action result");
    expect(completed.result).toEqual(Result.ok({
      kind: "google_drive_passport_file_deleted",
      deletionStatus: "deleted",
    }));
    controller.dispose();
  });

  it("preserves a failed deletion result after ordinary unmount", async () => {
    const deletion = deferred<Awaited<ReturnType<PassportIdentityControllerDependencies["deleteGoogleDrivePassportFile"]>>>();
    const execute = deletionDouble(() => deletion.promise);
    const { controller, credentialCallback } = await mountedController({ deleteGoogleDrivePassportFile: execute.execute });
    credentialCallback.current?.(googleCredential());

    const pending = controller.continueGoogleBackedIdentityAction({ kind: "delete_google_drive_passport_file", expectedPublicKeyZ32: "public-key" });
    await vi.waitFor(() => expect(execute.calls).toBe(1));
    controller.unmountGoogleSignIn();
    deletion.resolve(Result.err({ code: "drive_delete_failed" }));

    const completed = await pending;
    expect(completed.status).toBe("action_finished_after_unmount");
    if (completed.status !== "action_finished_after_unmount") throw new Error("Expected unmounted action result");
    expect(Result.isError(completed.result)).toBe(true);
    if (Result.isError(completed.result)) expect(completed.result.error).toEqual({ code: "drive_delete_failed" });
    controller.dispose();
  });

  it("delegates safe local identity operations and owns Pubky disposal", () => {
    const list = vi.fn(() => Result.ok({ activeIdentityId: null, identities: [] }));
    const select = vi.fn(() => Result.ok());
    const clear = vi.fn(() => Result.ok());
    const subscribe = vi.fn(() => () => {});
    const disposeGoogleBackedIdentityOperations = vi.fn();
    const controller = new PassportIdentityController(
      dependencies({ list, select, clear, subscribe, disposeGoogleBackedIdentityOperations }),
    );

    expect(controller.list()).toEqual(Result.ok({ activeIdentityId: null, identities: [] }));
    controller.select("identity");
    controller.clear();
    controller.dispose();
    controller.dispose();

    expect(select).toHaveBeenCalledWith("identity");
    expect(clear).toHaveBeenCalledOnce();
    expect(disposeGoogleBackedIdentityOperations).toHaveBeenCalledOnce();
  });
});

async function mountedController(
  overrides: Partial<PassportIdentityControllerDependencies> = {},
  states: unknown[] = [],
) {
  const credentialCallback: {
    current: ((result: GoogleSignInResult<{ googleIdToken: string; subject: string }>) => void) | null;
  } = { current: null };
  const controller = new PassportIdentityController(dependencies({
    mountGoogleSignIn: vi.fn(async (_target, onCredential) => {
        credentialCallback.current = onCredential;
        return Result.ok();
      }),
    unmountGoogleSignIn: vi.fn(),
    ...overrides,
  }));
  await controller.mountGoogleSignIn(document.createElement("div"), (state) => states.push(state));
  return { controller, credentialCallback };
}

function dependencies(overrides: Partial<PassportIdentityControllerDependencies> = {}): PassportIdentityControllerDependencies {
  return {
    list: vi.fn(() => Result.ok({ activeIdentityId: null, identities: [] })),
    select: vi.fn(() => Result.ok()),
    clear: vi.fn(() => Result.ok()),
    subscribe: vi.fn(() => () => {}),
    restoreOrCreateGoogleBackedIdentity: async () => Result.err({ code: "unexpected_failure" as const }),
    deleteGoogleDrivePassportFile: async () => Result.ok({ status: "deleted" as const }),
    disposeGoogleBackedIdentityOperations: vi.fn(),
    mountGoogleSignIn: vi.fn(async () => Result.ok()),
    unmountGoogleSignIn: vi.fn(),
    requestGoogleDriveAccess: async () => Result.ok("drive-access-token"),
    ...overrides,
  };
}

function googleCredential() {
  return Result.ok({ googleIdToken: "google-id-token", subject: "google-subject" });
}

function driveAccessDouble(
  implementation: () => ReturnType<PassportIdentityControllerDependencies["requestGoogleDriveAccess"]>,
) {
  const double = {
    record: { calls: 0, subjectPresent: false, matchesExpectedSubject: false, hasSignal: false },
    async execute(
      googleSubject: string,
      signal: AbortSignal,
    ) {
      double.record.calls += 1;
      double.record.subjectPresent = googleSubject.length > 0;
      double.record.matchesExpectedSubject = googleSubject === GOOGLE_SUBJECT_CANARY;
      double.record.hasSignal = signal instanceof AbortSignal;
      return implementation();
    },
  };
  return double;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function establishmentDouble(
  implementation: (
    reportProgress: Parameters<PassportIdentityControllerDependencies["restoreOrCreateGoogleBackedIdentity"]>[1],
  ) => ReturnType<PassportIdentityControllerDependencies["restoreOrCreateGoogleBackedIdentity"]>,
) {
  const double = {
    calls: 0,
    receivedExpectedCredentials: false,
    async execute(
      credentials: { googleIdToken: string; driveAccessToken: string },
      reportProgress: Parameters<PassportIdentityControllerDependencies["restoreOrCreateGoogleBackedIdentity"]>[1],
    ) {
      double.calls += 1;
      double.receivedExpectedCredentials = credentials.googleIdToken.length > 0
        && credentials.driveAccessToken.length > 0;
      return implementation(reportProgress);
    },
  };
  return double;
}

function deletionDouble(
  implementation: () => ReturnType<PassportIdentityControllerDependencies["deleteGoogleDrivePassportFile"]>,
) {
  const double = {
    calls: 0,
    receivedExpectedInput: false,
    async execute(
      credentials: { googleIdToken: string; driveAccessToken: string },
      expectedPublicKeyZ32: string,
    ) {
      double.calls += 1;
      double.receivedExpectedInput = credentials.googleIdToken.length > 0
        && credentials.driveAccessToken.length > 0
        && expectedPublicKeyZ32 === "public-key";
      return implementation();
    },
  };
  return double;
}
