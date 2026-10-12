/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthorizationReview } from "./authorizationReview";

function props() {
  return {
    identity: { publicIdentity: { publicKeyZ32: "identity-public-key" } },
    onAuthorize: vi.fn(),
    onCancel: vi.fn(),
    onManage: vi.fn(),
    onSwitch: vi.fn(),
    phase: "review" as const,
    review: {
      authenticationMethod: "cookie" as const,
      capabilities: [
        { path: "/pub/client.app/", read: true, write: true, scope: "specific" as const },
      ],
      callbackHost: "client.app",
    },
  };
}

afterEach(cleanup);

describe("AuthorizationReview identity actions", () => {
  it("offers Manage and Switch as separate identity actions", async () => {
    const user = userEvent.setup();
    const reviewProps = props();
    render(<AuthorizationReview {...reviewProps} />);
    await user.click(screen.getByRole("button", { name: "Manage" }));
    await user.click(screen.getByRole("button", { name: "Switch" }));

    expect(reviewProps.onManage).toHaveBeenCalledOnce();
    expect(reviewProps.onSwitch).toHaveBeenCalledOnce();
    expect(reviewProps.onAuthorize).not.toHaveBeenCalled();
    expect(reviewProps.onCancel).not.toHaveBeenCalled();
  });

  it.each(["preparing", "granting", "completing"] as const)(
    "locks identity actions during %s",
    (phase) => {
      render(<AuthorizationReview {...props()} phase={phase} />);
      expect(screen.getByRole("button", { name: "Manage" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Switch" })).toBeDisabled();
    },
  );

  it("does not allow management without a local identity", () => {
    render(<AuthorizationReview {...props()} identity={undefined} />);
    expect(screen.getByRole("button", { name: "Manage" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Authorize" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Switch" })).toBeEnabled();
  });
});
