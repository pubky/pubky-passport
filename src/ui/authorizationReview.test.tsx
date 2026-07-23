/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BrowserAuthorizationController,
  BrowserAuthorizationViewState,
} from "../browser/authorization/browserAuthorizationController";
import { AuthorizationReview } from "./authorizationReview";

const review = {
  kind: "signin" as const,
  requestingAppDisplayName: "app.example",
  callbackAvailability: { success: true, error: true, cancel: true },
  capabilities: [{ path: "/pub/example.app/", read: true, write: true, scope: "broad" as const }],
};

describe("AuthorizationReview", () => {
  afterEach(cleanup);

  it("renders safe review state and delegates approval and cancellation intents", async () => {
    const user = userEvent.setup();
    const controller = fakeController({ status: "review", review });

    render(<AuthorizationReview controllerFactory={() => controller} relayOrigin="https://relay.example" />);

    expect(screen.getByRole("heading", { name: "app.example" })).toBeTruthy();
    expect(screen.getByText("/pub/example.app/")).toBeTruthy();
    expect(screen.getByText("Read and Write")).toBeTruthy();
    expect(screen.getByText("Broad access")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(controller.approve).toHaveBeenCalledOnce();
    expect(controller.cancel).toHaveBeenCalledOnce();
    expect(controller.mounted).toHaveBeenCalledOnce();
  });

  it("renders controller state transitions without receiving sensitive values", () => {
    const controller = fakeController({ status: "review", review });
    const rendered = render(<AuthorizationReview controllerFactory={() => controller} relayOrigin="https://relay.example" />);

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
    render(<AuthorizationReview controllerFactory={() => fakeController(state)} relayOrigin="https://relay.example" />);

    expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
  });
});

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
