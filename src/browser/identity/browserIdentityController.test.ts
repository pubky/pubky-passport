/** @vitest-environment jsdom */

import { Result } from "better-result";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { PubkyIdentityKeyHandle } from "../../features/identity/pubkyIdentity";
import type { BrowserIdentityControllerError } from "./browserIdentityController";
import {
  DefaultBrowserIdentityController,
  type BrowserIdentityControllerDependencies,
} from "./browserIdentityControllerInternals";
import type { GoogleSignInWidgetResult } from "./google/ports";

describe("DefaultBrowserIdentityController", () => {
  it("exposes a finite action error code contract", () => {
    expectTypeOf<BrowserIdentityControllerError["code"]>().not.toEqualTypeOf<string>();
  });

  it("keeps Google credentials private and returns a safe established identity", async () => {
    const keyHandle = {} as PubkyIdentityKeyHandle;
    const establish = vi.fn(async () => Result.ok({
      keyHandle,
      source: "restored" as const,
      publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
    }));
    const disposeIdentityKey = vi.fn();
    const requestGoogleDriveAccess = vi.fn(async () => Result.ok("drive-access-token"));
    const { controller, credentialCallback } = await mountedController({
      identityFlow: { establish },
      identityKeys: { disposeIdentityKey },
      requestGoogleDriveAccess,
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
    expect(disposeIdentityKey).toHaveBeenCalledWith({ keyHandle });
  });

  it("account-matches Drive access and exposes only safe Google state", async () => {
    const states: unknown[] = [];
    const requestGoogleDriveAccess = vi.fn(async () => Result.err({ code: "drive_account_mismatch" as const }));
    const { controller, credentialCallback } = await mountedController({ requestGoogleDriveAccess }, states);

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
      identityFlow: { establish },
      requestGoogleDriveAccess,
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
    const controller = new DefaultBrowserIdentityController({
      clientId: "google-client",
      dependencies: dependencies({ googleSignInWidget: { mount, unmount: vi.fn() } }),
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
    const controller = new DefaultBrowserIdentityController({
      clientId: "google-client",
      dependencies: dependencies({ googleSignInWidget: { mount, unmount } }),
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
      requestGoogleDriveAccess: vi.fn(async () => { throw new Error("Drive failed"); }),
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
      identityDeletion: { execute: vi.fn(async () => { throw new Error("delete failed"); }) },
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

  it("preserves successful establishment when key disposal throws", async () => {
    const keyHandle = {} as PubkyIdentityKeyHandle;
    const { controller, credentialCallback } = await mountedController({
      identityFlow: { establish: vi.fn(async () => Result.ok({
        keyHandle,
        source: "created" as const,
        publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
      })) },
      identityKeys: { disposeIdentityKey: vi.fn(() => { throw new Error("dispose failed"); }) },
    });
    credentialCallback.current?.(googleCredential());

    const completed = await controller.continueGoogle({ kind: "establish" });
    expect(completed.status).toBe("action_completed");
    if (completed.status !== "action_completed") throw new Error("Expected action result");
    expect(Result.isError(completed.result)).toBe(false);
    if (Result.isError(completed.result)) throw new Error("Expected action success");
    expect(completed.result.value).toEqual({
      kind: "established",
      source: "created",
      publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
    });
  });

  it("runs Google continuation single-flight without reusing credentials", async () => {
    let resolveDrive: ((value: ReturnType<typeof Result.ok<string>>) => void) | undefined;
    const requestGoogleDriveAccess = vi.fn(() => new Promise<ReturnType<typeof Result.ok<string>>>((resolve) => {
      resolveDrive = resolve;
    }));
    const establish = vi.fn(async () => Result.err({ code: "unexpected_failure" as const }));
    const { controller, credentialCallback } = await mountedController({
      requestGoogleDriveAccess,
      identityFlow: { establish },
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

  it("defers one-time Pubky disposal and suppresses completion after dispose", async () => {
    let resolveEstablish: ((value: ReturnType<typeof Result.ok<{
      keyHandle: PubkyIdentityKeyHandle;
      source: "restored";
      publicIdentity: { publicKeyZ32: string; publicKeyDisplay: string };
    }>>) => void) | undefined;
    const keyHandle = {} as PubkyIdentityKeyHandle;
    const disposePubky = vi.fn();
    const disposeIdentityKey = vi.fn();
    const establish = vi.fn<BrowserIdentityControllerDependencies["identityFlow"]["establish"]>(
      () => new Promise((resolve) => { resolveEstablish = resolve; }),
    );
    const { controller, credentialCallback } = await mountedController({
      identityFlow: { establish },
      identityKeys: { disposeIdentityKey },
      disposePubky,
    });
    credentialCallback.current?.(googleCredential());

    const pending = controller.continueGoogle({ kind: "establish" });
    await vi.waitFor(() => expect(establish).toHaveBeenCalledOnce());
    controller.dispose();
    controller.dispose();
    expect(disposePubky).not.toHaveBeenCalled();
    resolveEstablish?.(Result.ok({
      keyHandle,
      source: "restored",
      publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
    }));

    const completed = await pending;
    expect(completed.status).toBe("action_finished_after_unmount");
    if (completed.status !== "action_finished_after_unmount") throw new Error("Expected superseded action result");
    expect(Result.isError(completed.result)).toBe(false);
    expect(disposeIdentityKey).toHaveBeenCalledWith({ keyHandle });
    expect(disposePubky).toHaveBeenCalledOnce();
  });

  it("delegates safe local identity operations and owns Pubky disposal", () => {
    const repository = fakeRepository();
    const disposePubky = vi.fn();
    const controller = new DefaultBrowserIdentityController({
      clientId: "google-client",
      dependencies: dependencies({ repository, disposePubky }),
    });

    expect(controller.list()).toEqual(Result.ok({ activeIdentityId: null, identities: [] }));
    controller.select("identity");
    controller.clear();
    controller.dispose();
    controller.dispose();

    expect(repository.select).toHaveBeenCalledWith("identity");
    expect(repository.clear).toHaveBeenCalledOnce();
    expect(disposePubky).toHaveBeenCalledOnce();
  });
});

async function mountedController(
  overrides: Partial<BrowserIdentityControllerDependencies> = {},
  states: unknown[] = [],
) {
  const credentialCallback: {
    current: ((result: GoogleSignInWidgetResult<{ googleIdToken: string; subject: string }>) => void) | null;
  } = { current: null };
  const controller = new DefaultBrowserIdentityController({
    clientId: "google-client",
    dependencies: dependencies({
      googleSignInWidget: {
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
    identityFlow: { establish: vi.fn(async () => Result.err({ code: "unexpected_failure" as const })) },
    identityDeletion: { execute: vi.fn(async () => Result.ok()) },
    identityKeys: { disposeIdentityKey: vi.fn() },
    disposePubky: vi.fn(),
    googleSignInWidget: { mount: vi.fn(async () => Result.ok()), unmount: vi.fn() },
    requestGoogleDriveAccess: vi.fn(async () => Result.ok("drive-access-token")),
    ...overrides,
  };
}

function googleCredential() {
  return Result.ok({ googleIdToken: "google-id-token", subject: "google-subject" });
}

function fakeRepository(): BrowserIdentityControllerDependencies["repository"] {
  return {
    list: vi.fn(() => Result.ok({ activeIdentityId: null, identities: [] })),
    save: vi.fn((input) => Result.ok(input.identity)),
    select: vi.fn(() => Result.ok()),
    clear: vi.fn(() => Result.ok()),
    readActive: vi.fn(() => Result.err({ code: "no_active_identity" as const })),
  };
}
