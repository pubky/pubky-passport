/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import { fakePassportAuthorizationController } from "@test-utils/fakePassportAuthorizationController";
import type { LocalIdentityErrorCode } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { IdentityCatalogUnavailableReason } from "@/client/ui/identity-catalog/useIdentityCatalog";
import { IdentitiesUnavailable } from "./identitiesUnavailable";

const REVIEW = {
  authenticationMethod: "cookie",
  capabilities: [{ path: "/pub/notes.example/", read: true, write: true, scope: "specific" }],
  callbackHost: "notes.example",
  requesterName: "Acme Notes",
} as const;
const REQUEST = "pubkyauth://signin?relay=https://relay.example/inbox&secret=exact-request";

function renderScreen(
  authorization: PassportAuthorizationViewState,
  reason: IdentityCatalogUnavailableReason = "storage_blocked",
  code: LocalIdentityErrorCode = "storage_unavailable",
) {
  const cancel = vi.fn();
  const finishExternalApproval = vi.fn();
  render(
    <IdentitiesUnavailable
      authorization={authorization}
      code={code}
      reason={reason}
      controller={fakePassportAuthorizationController(
        { current: authorization },
        { cancel, externalSignerUrl: () => REQUEST, finishExternalApproval },
      )}
    />,
  );
  return { cancel, finishExternalApproval };
}

describe("IdentitiesUnavailable", () => {
  beforeEach(() => {
    // A computer: the hand-off shows the QR code instead of following the link.
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("names blocked site data as the cause and offers to try again once it is allowed", () => {
    renderScreen({ status: "manual-entry" });

    const heading = screen.getByRole("heading", { name: "Identities unavailable." });
    expect(heading).toHaveAccessibleDescription(
      /^Your browser is blocking Passport's storage\. This happens in private windows or when site data is turned off for this site\. Allow site data for this site, then try again\.$/u,
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText("storage_unavailable")).toBeInTheDocument();
  });

  it("does not blame site data when what is stored cannot be read, and keeps the real code", () => {
    renderScreen({ status: "manual-entry" }, "unreadable_store", "invalid_secret_key");

    expect(
      screen.getByText("Passport's saved data in this browser can't be read."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/site data/u)).toBeNull();
    // Support can tell a bad key entry from a corrupt catalog.
    expect(screen.getByText("invalid_secret_key")).toBeInTheDocument();
    expect(screen.queryByText("unreadable_store")).toBeNull();
  });

  it("offers Pubky Ring beside Cancel during a request, which needs no storage here", async () => {
    const user = userEvent.setup();
    const { cancel } = renderScreen({ status: "review", review: REVIEW });

    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(
      screen.getByText(/^Continue with Pubky Ring instead, or cancel this sign-in/u),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Continue with Pubky Ring" }));
    expect(screen.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pubky authorization QR code" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Identities unavailable." })).toBeInTheDocument();
  });

  it("hands Ring's reported approval back through the request", async () => {
    const user = userEvent.setup();
    const { finishExternalApproval } = renderScreen({ status: "review", review: REVIEW });

    await user.click(screen.getByRole("button", { name: "Continue with Pubky Ring" }));
    await user.click(screen.getByRole("button", { name: "I approved in Pubky Ring" }));

    expect(finishExternalApproval).toHaveBeenCalledOnce();
  });
});
