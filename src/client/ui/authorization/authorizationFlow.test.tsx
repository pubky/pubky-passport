/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { fakePassportAuthorizationController } from "@test-utils/fakePassportAuthorizationController";
import { AuthorizationFlow, type AuthorizationRequestState } from "./authorizationFlow";

const REVIEW = {
  authenticationMethod: "cookie",
  capabilities: [{ path: "/pub/requesting.app/", read: true, write: true, scope: "specific" }],
  callbackHost: "requesting.app",
} as const;
const LOCAL: LocalIdentityMetadata = { publicIdentity: { publicKeyZ32: "local-key" } };
const RING: LocalIdentityMetadata = {
  publicIdentity: { publicKeyZ32: "ring-key" },
  keySource: "ring",
};

function renderFlow(
  authorization: AuthorizationRequestState,
  identity: LocalIdentityMetadata | undefined = LOCAL,
) {
  const approve = vi.fn();
  const cancel = vi.fn();
  const onSwitch = vi.fn();
  const onUseRing = vi.fn();
  render(
    <AuthorizationFlow
      authorization={authorization}
      controller={fakePassportAuthorizationController(
        { current: authorization },
        { approve, cancel },
      )}
      identity={identity}
      onSwitch={onSwitch}
      onUseRing={onUseRing}
    />,
  );
  return { approve, cancel, onSwitch, onUseRing };
}

describe("AuthorizationFlow", () => {
  afterEach(cleanup);

  it("approves with a local identity", async () => {
    const { approve, onUseRing } = renderFlow({ status: "review", review: REVIEW });

    await userEvent.setup().click(screen.getByRole("button", { name: "Authorize" }));

    expect(approve).toHaveBeenCalledWith("local-key");
    expect(onUseRing).not.toHaveBeenCalled();
  });

  it("offers one action for a Ring-held identity and hands the request to Ring", async () => {
    const { approve, onUseRing } = renderFlow({ status: "review", review: REVIEW }, RING);

    // Ring signs with its own key, so Authorize and a second Ring button would do the same thing.
    expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use Pubky Ring" })).not.toBeInTheDocument();
    expect(screen.getByText(/You choose the identity to sign in with in Ring/u)).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue in Pubky Ring" }));

    expect(onUseRing).toHaveBeenCalledOnce();
    expect(approve).not.toHaveBeenCalled();
  });

  it("keeps Authorize and the separate Ring option for an identity held in Passport", () => {
    renderFlow({ status: "review", review: REVIEW });

    expect(screen.getByRole("button", { name: "Authorize" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Use Pubky Ring" })).toBeEnabled();
    expect(screen.queryByText(/You choose the identity to sign in with in Ring/u)).toBeNull();
  });

  it("cancels and switches from review", async () => {
    const user = userEvent.setup();
    const { cancel, onSwitch } = renderFlow({ status: "review", review: REVIEW });

    await user.click(screen.getByRole("button", { name: "Switch identity" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSwitch).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("disables every action while approval runs", () => {
    renderFlow({ status: "granting", review: REVIEW });

    // The pressed button shows the work and keeps focus, so it is busy rather than disabled.
    const authorize = screen.getByRole("button", { name: "Granting access…" });
    expect(authorize).toHaveAttribute("aria-busy", "true");
    expect(authorize).toHaveAttribute("aria-disabled", "true");
    expect(authorize).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Switch identity" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Use Pubky Ring" })).toBeDisabled();
  });

  it.each([
    [{ status: "invalid" }, "Invalid authorization request", "Back"],
    [{ status: "approved" }, "Authorization complete.", "Continue"],
    [{ status: "handed-off" }, "Return to the app.", "Continue"],
    [{ status: "cancelled" }, "Authorization cancelled.", "Back"],
    [{ status: "failed" }, "Authorization failed.", "Back"],
  ] as const)("renders the %o outcome without a review", (authorization, heading, action) => {
    renderFlow(authorization);

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();
  });
});

it("never claims an approval Passport handed to Ring", () => {
  renderFlow({ status: "handed-off" });

  expect(screen.getByText(/Passport cannot see the approval in Pubky Ring/u)).toBeVisible();
  expect(screen.queryByText(/Authorization complete/u)).toBeNull();
  cleanup();
});
