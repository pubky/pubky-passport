/** @vitest-environment jsdom */

import { Result } from "better-result";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BrowserAuthorizationController,
  BrowserAuthorizationViewState,
} from "../browser/authorization/browserAuthorizationController";
import type { BrowserIdentityController } from "../browser/identity/browserIdentityController";
import { AuthorizationReview } from "./authorizationReview";

const review = {
  kind: "signin" as const,
  requestingAppDisplayName: "app.example",
  callbackAvailability: { success: true, error: true, cancel: true },
  relayHost: "relay.client.example",
  capabilities: [{ path: "/pub/example.app/", read: true, write: true, scope: "broad" as const }],
};

describe("AuthorizationReview", () => {
  afterEach(cleanup);

  it("renders safe review state and delegates approval and cancellation intents", async () => {
    const user = userEvent.setup();
    const controller = fakeController({ status: "review", review });

    renderReview(controller);

    expect(screen.getByRole("heading", { name: "app.example" })).toBeTruthy();
    expect(screen.getByText("Requesting app (unverified)")).toBeTruthy();
    expect(screen.getByText("relay.client.example")).toBeTruthy();
    expect(screen.getByText("/pub/example.app/")).toBeTruthy();
    expect(screen.getByText("Read and Write")).toBeTruthy();
    expect(screen.getByText("Broad access")).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Authorization identity" }) as HTMLSelectElement).value).toBe("identity-1"));
    await waitFor(() => expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Add or restore with Google" }));
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancel sign-in" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(controller.approve).toHaveBeenCalledOnce();
    expect(controller.cancel).toHaveBeenCalledOnce();
    expect(controller.mounted).toHaveBeenCalledOnce();
  });

  it("renders controller state transitions without receiving sensitive values", () => {
    const controller = fakeController({ status: "review", review });
    const rendered = renderReview(controller);

    act(() => controller.emit({ status: "approving", review }));
    expect(screen.getByRole("button", { name: "Approving..." })).toHaveProperty("disabled", true);

    act(() => controller.emit({ status: "approved" }));
    expect(screen.getByRole("heading", { name: "Authorization complete" })).toBeTruthy();
    rendered.unmount();
  });

  it.each([
    [{ status: "invalid" as const }, "Invalid authorization request", "The request cannot be safely authorized."],
    [{ status: "cancelled" as const }, "Authorization cancelled", "No authorization was granted."],
    [{ status: "failed" as const, failureCode: "no_active_identity" as const }, "Authorization failed", "Passport could not find an active identity. Set up or select an identity before trying again."],
    [{ status: "failed" as const, failureCode: "identity_restore_failed" as const }, "Authorization failed", "Passport could not restore the active identity. Return to Passport and restore it before trying again."],
    [{ status: "failed" as const, failureCode: "approval_failed" as const }, "Authorization failed", "Passport could not sign or deliver this authorization. Please try again."],
  ])("renders the safe %s terminal state", (state, heading, message) => {
    renderReview(fakeController(state));

    expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
  });
});

function renderReview(controller: BrowserAuthorizationController) {
  return render(
    <AuthorizationReview
      controllerFactory={() => controller}
      googleClientId="google-client"
      homegateBaseUrl="https://homegate.example/"
      identityControllerFactory={() => fakeIdentityController()}
    />,
  );
}

function fakeController(initialState: BrowserAuthorizationViewState): BrowserAuthorizationController & {
  emit(state: BrowserAuthorizationViewState): void;
} {
  let state = initialState;
  const listeners = new Set<(nextState: BrowserAuthorizationViewState) => void>();
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mounted: vi.fn(),
    approve: vi.fn(async () => state),
    cancel: vi.fn(() => state),
    emit: (nextState) => {
      state = nextState;
      for (const listener of listeners) listener(nextState);
    },
  };
}

function fakeIdentityController(): BrowserIdentityController {
  return {
    list: vi.fn(() => Result.ok({
      activeIdentityId: "identity-1",
      identities: [{
        id: "identity-1",
        publicIdentity: {
          publicKeyZ32: "identity-1",
          publicKeyDisplay: "pubkyidentity-1",
        },
      }],
    })),
    select: vi.fn(() => Result.ok()),
    clear: vi.fn(() => Result.ok()),
    subscribe: vi.fn(() => () => {}),
    mountGoogleSignIn: vi.fn(async () => undefined),
    unmountGoogleSignIn: vi.fn(),
    retryGoogleSignIn: vi.fn(),
    continueGoogle: vi.fn(async () => ({ status: "busy" as const })),
    dispose: vi.fn(),
  };
}
