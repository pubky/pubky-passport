/** @vitest-environment jsdom */

import { Result } from "better-result";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { PubkyIdentityKeyHandle } from "../../features/identity/pubkyIdentity";
import {
  DefaultBrowserIdentityController,
  type BrowserIdentityControllerError,
  type BrowserIdentityControllerDependencies,
} from "./browserIdentityController";
import type { GoogleCredentialResponse } from "./google/googleIdentityProvider";

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

    credentialCallback.current?.({ credential: "google-id-token" });
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

    credentialCallback.current?.({ credential: "google-id-token" });
    const completed = await controller.continueGoogle({ kind: "establish" });

    expect(completed).toEqual({ status: "credential_failed" });
    expect(states).toContainEqual({ stage: "drive", error: null });
    expect(states).toContainEqual({
      stage: "sign-in",
      error: "Choose the same Google account for sign-in and Drive, then try again.",
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
    credentialCallback.current?.({ credential: "google-id-token" });

    const pending = controller.continueGoogle({ kind: "establish" });
    controller.unmountGoogleSignIn();
    resolveDrive?.(Result.ok("late-drive-token"));

    await expect(pending).resolves.toEqual({ status: "credential_failed" });
    expect(driveSignal?.aborted).toBe(true);
    expect(establish).not.toHaveBeenCalled();
  });

  it.each([
    ["loading", { loadGoogleAccounts: vi.fn(async () => { throw new Error("load failed"); }) }],
    ["binding", { bindGoogleCredentialCallback: vi.fn(() => { throw new Error("bind failed"); }) }],
    ["rendering", {
      loadGoogleAccounts: vi.fn(async () => Result.ok({
        id: { initialize: vi.fn(), renderButton: vi.fn(() => { throw new Error("render failed"); }) },
        oauth2: { initTokenClient: vi.fn() },
      })),
    }],
  ])("maps thrown Google provider %s failures to safe state", async (_operation, overrides) => {
    const states: unknown[] = [];
    const controller = new DefaultBrowserIdentityController({
      clientId: "google-client",
      dependencies: dependencies(overrides),
    });

    await expect(controller.mountGoogleSignIn(document.createElement("div"), (state) => states.push(state))).resolves.toBeUndefined();

    expect(states.at(-1)).toEqual({
      stage: "sign-in",
      error: "Google sign-in is unavailable. Try again.",
    });
  });

  it("releases a partially mounted provider callback and retries initialization", async () => {
    const renderButton = vi.fn()
      .mockImplementationOnce(() => { throw new Error("render failed"); })
      .mockImplementationOnce(() => {});
    const loadGoogleAccounts = vi.fn(async () => Result.ok({
      id: { initialize: vi.fn(), renderButton },
      oauth2: { initTokenClient: vi.fn() },
    }));
    const releaseGoogleCredentialCallback = vi.fn();
    const states: unknown[] = [];
    const controller = new DefaultBrowserIdentityController({
      clientId: "google-client",
      dependencies: dependencies({ loadGoogleAccounts, releaseGoogleCredentialCallback }),
    });

    await controller.mountGoogleSignIn(document.createElement("div"), (state) => states.push(state));
    expect(releaseGoogleCredentialCallback).toHaveBeenCalledOnce();

    controller.retryGoogleSignIn();
    await vi.waitFor(() => expect(loadGoogleAccounts).toHaveBeenCalledTimes(2));

    expect(renderButton).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toEqual({ stage: "sign-in", error: null });
  });

  it("maps thrown Drive acquisition to credential failure without rejecting", async () => {
    const states: unknown[] = [];
    const { controller, credentialCallback } = await mountedController({
      requestGoogleDriveAccess: vi.fn(async () => { throw new Error("Drive failed"); }),
    }, states);
    credentialCallback.current?.({ credential: "google-id-token" });

    await expect(controller.continueGoogle({ kind: "establish" })).resolves.toEqual({ status: "credential_failed" });
    expect(states.at(-1)).toEqual({
      stage: "sign-in",
      error: "Google Drive permission was not granted. Try again.",
    });
  });

  it("maps thrown identity actions to an unexpected failure result", async () => {
    const { controller, credentialCallback } = await mountedController({
      identityDeletion: { execute: vi.fn(async () => { throw new Error("delete failed"); }) },
    });
    credentialCallback.current?.({ credential: "google-id-token" });

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

  it("maps thrown key disposal to an unexpected failure result", async () => {
    const keyHandle = {} as PubkyIdentityKeyHandle;
    const { controller, credentialCallback } = await mountedController({
      identityFlow: { establish: vi.fn(async () => Result.ok({
        keyHandle,
        source: "created" as const,
        publicIdentity: { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" },
      })) },
      identityKeys: { disposeIdentityKey: vi.fn(() => { throw new Error("dispose failed"); }) },
    });
    credentialCallback.current?.({ credential: "google-id-token" });

    const completed = await controller.continueGoogle({ kind: "establish" });
    expect(completed.status).toBe("action_completed");
    if (completed.status !== "action_completed") throw new Error("Expected action result");
    expect(Result.isError(completed.result)).toBe(true);
    if (!Result.isError(completed.result)) throw new Error("Expected action failure");
    expect(completed.result.error).toEqual({ code: "unexpected_failure" });
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
  const credentialCallback: { current: ((response: GoogleCredentialResponse) => void) | null } = { current: null };
  const controller = new DefaultBrowserIdentityController({
    clientId: "google-client",
    dependencies: dependencies({
      bindGoogleCredentialCallback: vi.fn((input) => {
        credentialCallback.current = input.callback;
        return Result.ok();
      }),
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
    loadGoogleAccounts: vi.fn(async () => Result.ok({
      id: { initialize: vi.fn(), renderButton: vi.fn() },
      oauth2: { initTokenClient: vi.fn() },
    })),
    bindGoogleCredentialCallback: vi.fn(() => Result.ok()),
    releaseGoogleCredentialCallback: vi.fn(),
    googleIdTokenSubject: vi.fn(() => "google-subject"),
    requestGoogleDriveAccess: vi.fn(async () => Result.ok("drive-access-token")),
    ...overrides,
  };
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
