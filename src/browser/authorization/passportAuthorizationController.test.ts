import { Result } from "better-result";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { parsePubkyAuthRequest } from "../../core/auth/parsePubkyAuthRequest";
import type { ParsedAuthorizationEntry } from "./application/authorizationEntry";
import type { ActiveAuthorizationResult } from "./application/approveActiveAuthorization";
import type { BrowserAuthorizationController, BrowserAuthorizationViewState } from "./browserAuthorizationController";
import {
  PassportAuthorizationController,
  type PassportAuthorizationControllerDependencies,
} from "./passportAuthorizationController";

const relayOrigin = "https://relay.example";
const successCallback = "https://app.example/success?code=private";
const errorCallback = "https://app.example/error?code=private";
const cancelCallback = "https://app.example/cancel?code=private";
const secret = "sensitive-authorization-secret";

describe("PassportAuthorizationController", () => {
  it("exposes only finite safe view states and intent methods", () => {
    expectTypeOf<BrowserAuthorizationViewState["status"]>().not.toEqualTypeOf<string>();

    const controller = createController();
    const serialized = JSON.stringify(controller.getState());

    expect(controller.getState()).toMatchObject({
      status: "review",
      review: { requestingAppDisplayName: "app.example" },
    });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(successCallback);
    expect(serialized).not.toContain(errorCallback);
    expect(serialized).not.toContain(cancelCallback);
    expect(Object.keys(controller).sort()).toEqual([]);
  });

  it("commits the authorization entry when mounted", () => {
    const commitAuthorizationEntry = vi.fn();
    const controller = createController({ commitAuthorizationEntry });

    controller.mounted();

    expect(commitAuthorizationEntry).toHaveBeenCalledOnce();
  });

  it("approves once and navigates to the exact success callback", async () => {
    let complete: ((result: ActiveAuthorizationResult) => void) | undefined;
    const approveAuthorization = vi.fn(() => new Promise<ActiveAuthorizationResult>((resolve) => { complete = resolve; }));
    const navigate = vi.fn();
    const controller = createController({ approveAuthorization, navigate });

    const first = controller.approve();
    const second = controller.approve();
    expect(controller.getState().status).toBe("approving");
    expect(approveAuthorization).toHaveBeenCalledOnce();
    complete?.(Result.ok());

    await expect(first).resolves.toMatchObject({ status: "redirecting" });
    await expect(second).resolves.toMatchObject({ status: "approving" });
    expect(navigate).toHaveBeenCalledWith(successCallback);
  });

  it("routes approval errors and cancellation through exact parser-owned callbacks", async () => {
    const navigate = vi.fn();
    const failed = createController({
      approveAuthorization: async () => Result.err({ code: "approval_failed" }),
      navigate,
    });
    await failed.approve();
    expect(navigate).toHaveBeenLastCalledWith(errorCallback);

    const cancelled = createController({ navigate });
    cancelled.cancel();
    expect(navigate).toHaveBeenLastCalledWith(cancelCallback);
  });

  it.each([
    ["success", async () => Result.ok(), "approved", "approve"],
    ["error", async () => Result.err({ code: "approval_failed" as const }), "failed", "approve"],
    ["cancel", async () => Result.ok(), "cancelled", "cancel"],
  ] as const)("falls back to a local %s outcome when callback navigation throws", async (_name, approveAuthorization, status, intent) => {
    const controller = createController({
      approveAuthorization,
      navigate: () => { throw new Error("navigation unavailable"); },
    });

    const state = intent === "approve" ? await controller.approve() : controller.cancel();

    expect(state.status).toBe(status);
  });

  it.each(["no_active_identity", "identity_restore_failed", "approval_failed"] as const)(
    "retains the safe %s failure code without callbacks",
    async (code) => {
      const controller = createController(
        { approveAuthorization: async () => Result.err({ code }) },
        validEntry({ callbacks: false }),
      );

      await expect(controller.approve()).resolves.toEqual({ status: "failed", failureCode: code });
    },
  );

  it("makes approval, cancellation, and state listeners exception-total", async () => {
    const controller = createController(
      { approveAuthorization: async () => { throw new Error("approval exploded"); } },
      validEntry({ callbacks: false }),
    );
    controller.subscribe(() => { throw new Error("listener exploded"); });

    await expect(controller.approve()).resolves.toEqual({ status: "failed", failureCode: "approval_failed" });
    expect(() => controller.cancel()).not.toThrow();
  });

  it("never approves or navigates an invalid request", async () => {
    const approveAuthorization = vi.fn(async () => Result.ok());
    const navigate = vi.fn();
    const controller = createController({ approveAuthorization, navigate }, { status: "invalid" });

    await expect(controller.approve()).resolves.toEqual({ status: "invalid" });
    expect(controller.cancel()).toEqual({ status: "invalid" });
    expect(approveAuthorization).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

function createController(
  overrides: Partial<PassportAuthorizationControllerDependencies> = {},
  entry: ParsedAuthorizationEntry = validEntry(),
): BrowserAuthorizationController {
  return new PassportAuthorizationController({
    entry,
    dependencies: {
      approveAuthorization: async () => Result.ok(),
      commitAuthorizationEntry: vi.fn(),
      navigate: vi.fn(),
      ...overrides,
    },
  });
}

function validEntry(options: { callbacks?: boolean } = {}): ParsedAuthorizationEntry {
  const parsed = parsePubkyAuthRequest(encodeURIComponent(validRequest(options)));
  if (Result.isError(parsed)) throw new Error("Test authorization request must parse");
  return { status: "valid", review: parsed.value.review, approval: parsed.value.approval };
}

function validRequest(options: { callbacks?: boolean } = {}): string {
  const callbacks = options.callbacks === false
    ? ""
    : `&x-success=${encodeURIComponent(successCallback)}&x-error=${encodeURIComponent(errorCallback)}&x-cancel=${encodeURIComponent(cancelCallback)}`;
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(`${relayOrigin}/inbox`)}&secret=${secret}${callbacks}`;
}
