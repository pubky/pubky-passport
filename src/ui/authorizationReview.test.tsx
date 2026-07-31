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
import { mockBrowserIdentityController } from "../../test-utils/fakes/mockBrowserIdentityController";
import { AuthorizationReview } from "./authorizationReview";

const REVIEW = {
  kind: "signin" as const,
  requestingAppDisplayName: "app.example",
  callbackAvailability: { success: true, error: true, cancel: true },
  relayHost: "relay.client.example",
  capabilities: [{ path: "/pub/example.app/", read: true, write: true, scope: "broad" as const }],
};

describe("AuthorizationReview", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders safe review state and delegates approval and cancellation intents", async () => {
    const user = userEvent.setup();
    const controller = fakeController({ status: "review", review: REVIEW });

    renderReview(controller);

    expect(screen.getByRole("heading", { name: "app.example" })).toBeInTheDocument();
    expect(screen.getByText("Requesting app (unverified)")).toBeInTheDocument();
    expect(screen.getByText("relay.client.example")).toBeInTheDocument();
    expect(screen.getByText("/pub/example.app/")).toBeInTheDocument();
    expect(screen.getByText("Read and Write")).toBeInTheDocument();
    expect(screen.getByText("Broad access")).toBeInTheDocument();
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Authorization Pubky identity" }) as HTMLSelectElement).value).toBe("identity-1"));
    await waitFor(() => expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Add or restore with Google" }));
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancel identity setup" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(controller.approve).toHaveBeenCalledOnce();
    expect(controller.cancel).toHaveBeenCalledOnce();
    expect(controller.mounted).toHaveBeenCalledOnce();
  });

  it("renders controller state transitions without receiving sensitive values", () => {
    const controller = fakeController({ status: "review", review: REVIEW });
    const rendered = renderReview(controller);

    act(() => controller.emit({ status: "approving", review: REVIEW }));
    expect(screen.getByRole("button", { name: "Approving..." })).toHaveProperty("disabled", true);

    act(() => controller.emit({ status: "approved" }));
    expect(screen.getByRole("heading", { name: "Authorization complete" })).toBeInTheDocument();
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

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("renders an unavailable state when approval rejects", async () => {
    const controller = fakeController({ status: "review", review: REVIEW });
    vi.mocked(controller.approve).mockRejectedValue(new Error("SECRET-AUTHORIZATION-URL"));
    renderReview(controller);

    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled());
    await userEvent.setup().click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByRole("heading", { name: "Authorization unavailable" })).toBeInTheDocument();
  });

  it("contains review cleanup failures during unmount", () => {
    const controller = fakeController({ status: "invalid" });
    controller.subscribe = vi.fn(() => () => { throw new Error("SECRET-CALLBACK-URL"); });
    const rendered = renderReview(controller);

    expect(() => rendered.unmount()).not.toThrow();
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
  return mockBrowserIdentityController({
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
    continueGoogleBackedIdentityAction: vi.fn(async () => ({ status: "busy" as const })),
  });
}
