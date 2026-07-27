/** @vitest-environment jsdom */

import { Result } from "better-result";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { BrowserIdentityControllerError } from "./browserIdentityController";
import {
  PassportIdentityController,
  type BrowserIdentityControllerDependencies,
} from "./passportIdentityController";
import type { GoogleSignInResult } from "./google-sign-in/application/googleSignIn";

describe("PassportIdentityController", () => {
  it("exposes a finite action error code contract", () => {
    expectTypeOf<BrowserIdentityControllerError["code"]>().not.toEqualTypeOf<string>();
  });

  it("keeps Google credentials private and returns a safe established identity", async () => {
    const establish = vi.fn(async () => Result.ok({
      source: "restored" as const,
      publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
    }));
    const requestGoogleDriveAccess = vi.fn(async () => Result.ok("drive-access-token"));
    const { controller, credentialCallback } = await mountedController({
      identityEstablisher: { establish },
      googleDriveAccessRequester: { request: requestGoogleDriveAccess },
    });

    credentialCallback.current?.(googleCredential());
    const completed = await controller.continueGoogle({ kind: "establish" });

    expect(requestGoogleDriveAccess).toHaveBeenCalledWith({
      clientId: "google-client",
      loginHint: "google-subject",
      expectedSubject: "google-subject",
      signal: expect.any(AbortSignal),
    });
    expect(establish).toHaveBeenCalledWith({
      googleIdToken: "google-id-token",
      driveAccessToken: "drive-access-token",
    });
    expect(completed).toEqual({
      status: "action_completed",
      result: Result.ok({
        kind: "established",
        source: "restored",
        publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
      }),
    });
    expect("keyHandle" in (completed.status === "action_completed" && !Result.isError(completed.result) ? completed.result.value : {})).toBe(false);
  });

  it("account-matches Drive access and exposes only safe Google state", async () => {
    const states: unknown[] = [];
    const requestGoogleDriveAccess = vi.fn(async () => Result.err({ code: "drive_account_mismatch" as const }));
    const { controller, credentialCallback } = await mountedController({
      googleDriveAccessRequester: { request: requestGoogleDriveAccess },
    }, states);

    credentialCallback.current?.(googleCredential());
    const completed = await controller.continueGoogle({ kind: "establish" });

    expect(completed).toEqual({ status: "credential_failed" });
    expect(states).toContainEqual({ stage: "drive", errorCode: null });
    expect(states).toContainEqual({
      stage: "sign-in",
      errorCode: "drive_account_mismatch",
    });
    expect(JSON.stringify(states)).not.toContain("google-id-token");
  });

  it("aborts pending Drive acquisition and ignores its result after unmount", async () => {
    let resolveDrive: ((value: ReturnType<typeof Result.ok<string>>) => void) | undefined;
    let driveSignal: AbortSignal | undefined;
    const establish = vi.fn(async () => Result.err({ code: "unexpected_failure" as const }));
    const requestGoogleDriveAccess = vi.fn((input: { signal: AbortSignal }) => {
      driveSignal = input.signal;
      return new Promise<ReturnType<typeof Result.ok<string>>>((resolve) => { resolveDrive = resolve; });
    });
    const { controller, credentialCallback } = await mountedController({
      identityEstablisher: { establish },
      googleDriveAccessRequester: { request: requestGoogleDriveAccess },
    });
    credentialCallback.current?.(googleCredential());

    const pending = controller.continueGoogle({ kind: "establish" });
    controller.unmountGoogleSignIn();
    resolveDrive?.(Result.ok("late-drive-token"));

    await expect(pending).resolves.toEqual({ status: "superseded" });
    expect(driveSignal?.aborted).toBe(true);
    expect(establish).not.toHaveBeenCalled();
  });

  it.each([
    ["throw", vi.fn(async () => { throw new Error("mount failed"); })],
    ["error", vi.fn(async () => Result.err({ code: "google_unavailable" as const }))],
  ])("maps a Google widget mount %s to safe state", async (_operation, mount) => {
    const states: unknown[] = [];
    const controller = new PassportIdentityController({
      clientId: "google-client",
      dependencies: dependencies({ googleSignInButton: { mount, unmount: vi.fn() } }),
    });

    await expect(controller.mountGoogleSignIn(document.createElement("div"), (state) => states.push(state))).resolves.toBeUndefined();

    expect(states.at(-1)).toEqual({
      stage: "sign-in",
      errorCode: "sign_in_unavailable",
    });
  });

  it("unmounts a failed widget and retries initialization", async () => {
    const mount = vi.fn()
      .mockResolvedValueOnce(Result.err({ code: "google_unavailable" as const }))
      .mockResolvedValueOnce(Result.ok());
    const unmount = vi.fn();
    const states: unknown[] = [];
    const controller = new PassportIdentityController({
      clientId: "google-client",
      dependencies: dependencies({ googleSignInButton: { mount, unmount } }),
    });

    await controller.mountGoogleSignIn(document.createElement("div"), (state) => states.push(state));
    expect(unmount).toHaveBeenCalled();

    controller.retryGoogleSignIn();
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2));

    expect(states.at(-1)).toEqual({ stage: "sign-in", errorCode: null });
  });

  it("maps thrown Drive acquisition to credential failure without rejecting", async () => {
    const states: unknown[] = [];
    const { controller, credentialCallback } = await mountedController({
      googleDriveAccessRequester: { request: vi.fn(async () => { throw new Error("Drive failed"); }) },
    }, states);
    credentialCallback.current?.(googleCredential());

    await expect(controller.continueGoogle({ kind: "establish" })).resolves.toEqual({ status: "credential_failed" });
    expect(states.at(-1)).toEqual({
      stage: "sign-in",
      errorCode: "drive_consent_failed",
    });
  });

  it("maps thrown identity actions to an unexpected failure result", async () => {
    const { controller, credentialCallback } = await mountedController({
      identityDeleter: { execute: vi.fn(async () => { throw new Error("delete failed"); }) },
    });
    credentialCallback.current?.(googleCredential());

    const completed = await controller.continueGoogle({
      kind: "delete",
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
    const requestGoogleDriveAccess = vi.fn(() => new Promise<ReturnType<typeof Result.ok<string>>>((resolve) => {
      resolveDrive = resolve;
    }));
    const establish = vi.fn(async () => Result.err({ code: "unexpected_failure" as const }));
    const { controller, credentialCallback } = await mountedController({
      googleDriveAccessRequester: { request: requestGoogleDriveAccess },
      identityEstablisher: { establish },
    });
    credentialCallback.current?.(googleCredential());

    const first = controller.continueGoogle({ kind: "establish" });
    await expect(controller.continueGoogle({ kind: "establish" })).resolves.toEqual({ status: "busy" });
    resolveDrive?.(Result.ok("drive-access-token"));
    await first;

    await expect(controller.continueGoogle({ kind: "establish" })).resolves.toEqual({ status: "credential_failed" });

    expect(requestGoogleDriveAccess).toHaveBeenCalledOnce();
    expect(establish).toHaveBeenCalledOnce();
  });

  it("defers one-time identity runtime disposal and suppresses completion after dispose", async () => {
    let resolveEstablish: ((value: ReturnType<typeof Result.ok<{
      source: "restored";
      publicIdentity: { publicKeyZ32: string; publicKeyDisplay: string };
    }>>) => void) | undefined;
    const disposeIdentityRuntime = vi.fn();
    const establish = vi.fn<BrowserIdentityControllerDependencies["identityEstablisher"]["establish"]>(
      () => new Promise((resolve) => { resolveEstablish = resolve; }),
    );
    const { controller, credentialCallback } = await mountedController({
      identityEstablisher: { establish },
      disposeIdentityRuntime,
    });
    credentialCallback.current?.(googleCredential());

    const pending = controller.continueGoogle({ kind: "establish" });
    await vi.waitFor(() => expect(establish).toHaveBeenCalledOnce());
    controller.dispose();
    controller.dispose();
    expect(disposeIdentityRuntime).not.toHaveBeenCalled();
    resolveEstablish?.(Result.ok({
      source: "restored",
      publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
    }));

    const completed = await pending;
    expect(completed.status).toBe("action_finished_after_unmount");
    if (completed.status !== "action_finished_after_unmount") throw new Error("Expected superseded action result");
    expect(Result.isError(completed.result)).toBe(false);
    expect(disposeIdentityRuntime).toHaveBeenCalledOnce();
  });

  it("preserves a failed establishment result after ordinary unmount", async () => {
    const establishment = deferred<Awaited<ReturnType<BrowserIdentityControllerDependencies["identityEstablisher"]["establish"]>>>();
    const establish = vi.fn(() => establishment.promise);
    const { controller, credentialCallback } = await mountedController({ identityEstablisher: { establish } });
    credentialCallback.current?.(googleCredential());

    const pending = controller.continueGoogle({ kind: "establish" });
    await vi.waitFor(() => expect(establish).toHaveBeenCalledOnce());
    controller.unmountGoogleSignIn();
    establishment.resolve(Result.err({ code: "signup_failed" }));

    const completed = await pending;
    expect(completed.status).toBe("action_finished_after_unmount");
    if (completed.status !== "action_finished_after_unmount") throw new Error("Expected unmounted action result");
    expect(Result.isError(completed.result)).toBe(true);
    if (Result.isError(completed.result)) expect(completed.result.error).toEqual({ code: "signup_failed" });
    controller.dispose();
  });

  it("preserves a successful deletion result after ordinary unmount", async () => {
    const deletion = deferred<Awaited<ReturnType<BrowserIdentityControllerDependencies["identityDeleter"]["execute"]>>>();
    const execute = vi.fn(() => deletion.promise);
    const { controller, credentialCallback } = await mountedController({ identityDeleter: { execute } });
    credentialCallback.current?.(googleCredential());

    const pending = controller.continueGoogle({ kind: "delete", expectedPublicKeyZ32: "public-key" });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    controller.unmountGoogleSignIn();
    deletion.resolve(Result.ok());

    const completed = await pending;
    expect(completed.status).toBe("action_finished_after_unmount");
    if (completed.status !== "action_finished_after_unmount") throw new Error("Expected unmounted action result");
    expect(completed.result).toEqual(Result.ok({ kind: "deleted" }));
    controller.dispose();
  });

  it("preserves a failed deletion result after ordinary unmount", async () => {
    const deletion = deferred<Awaited<ReturnType<BrowserIdentityControllerDependencies["identityDeleter"]["execute"]>>>();
    const execute = vi.fn(() => deletion.promise);
    const { controller, credentialCallback } = await mountedController({ identityDeleter: { execute } });
    credentialCallback.current?.(googleCredential());

    const pending = controller.continueGoogle({ kind: "delete", expectedPublicKeyZ32: "public-key" });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
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
    const repository = fakeRepository();
    const disposeIdentityRuntime = vi.fn();
    const controller = new PassportIdentityController({
      clientId: "google-client",
      dependencies: dependencies({ repository, disposeIdentityRuntime }),
    });

    expect(controller.list()).toEqual(Result.ok({ activeIdentityId: null, identities: [] }));
    controller.select("identity");
    controller.clear();
    controller.dispose();
    controller.dispose();

    expect(repository.select).toHaveBeenCalledWith("identity");
    expect(repository.clear).toHaveBeenCalledOnce();
    expect(disposeIdentityRuntime).toHaveBeenCalledOnce();
  });
});

async function mountedController(
  overrides: Partial<BrowserIdentityControllerDependencies> = {},
  states: unknown[] = [],
) {
  const credentialCallback: {
    current: ((result: GoogleSignInResult<{ googleIdToken: string; subject: string }>) => void) | null;
  } = { current: null };
  const controller = new PassportIdentityController({
    clientId: "google-client",
    dependencies: dependencies({
      googleSignInButton: {
        mount: vi.fn(async (input) => {
          credentialCallback.current = input.onCredential;
          return Result.ok();
        }),
        unmount: vi.fn(),
      },
      ...overrides,
    }),
  });
  await controller.mountGoogleSignIn(document.createElement("div"), (state) => states.push(state));
  return { controller, credentialCallback };
}

function dependencies(overrides: Partial<BrowserIdentityControllerDependencies> = {}): BrowserIdentityControllerDependencies {
  return {
    repository: fakeRepository(),
    identityEstablisher: { establish: vi.fn(async () => Result.err({ code: "unexpected_failure" as const })) },
    identityDeleter: { execute: vi.fn(async () => Result.ok()) },
    disposeIdentityRuntime: vi.fn(),
    googleSignInButton: { mount: vi.fn(async () => Result.ok()), unmount: vi.fn() },
    googleDriveAccessRequester: { request: vi.fn(async () => Result.ok("drive-access-token")) },
    ...overrides,
  };
}

function googleCredential() {
  return Result.ok({ googleIdToken: "google-id-token", subject: "google-subject" });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function fakeRepository(): BrowserIdentityControllerDependencies["repository"] {
  return {
    list: vi.fn(() => Result.ok({ activeIdentityId: null, identities: [] })),
    select: vi.fn(() => Result.ok()),
    clear: vi.fn(() => Result.ok()),
    subscribe: vi.fn(() => () => {}),
  };
}
