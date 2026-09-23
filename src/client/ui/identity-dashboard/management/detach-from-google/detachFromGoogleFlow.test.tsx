/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { mockGoogleIdentityController } from "@test-utils/mockGoogleIdentityController";
import type { GoogleIdentityController } from "@/client/logic/google-identity/GoogleIdentityController";
import { DetachFromGoogleFlow } from "./detachFromGoogleFlow";

const identity = {
  publicIdentity: { publicKeyZ32: "identity" },
  googleAccount: {
    googleSubject: "google-account",
    email: "user@example.com",
    name: "User",
    pictureUrl: null,
  },
};

describe("DetachFromGoogleFlow", () => {
  afterEach(cleanup);

  it.each([
    "google_detachment_permission_required",
    "google_drive_access_required",
    "google_authorization_denied",
  ] as const)("uses the shared permission screen for %s and returns to review", async (code) => {
    const detachIdentity = vi.fn<GoogleIdentityController["detachIdentity"]>(async () =>
      Result.err({ code }),
    );
    const controller = mockGoogleIdentityController({ detachIdentity });
    const user = userEvent.setup();
    render(
      withPassportTestProviders(
        <DetachFromGoogleFlow
          createRecoveryFile={vi.fn()}
          createMigration={vi.fn()}
          googleSubject={identity.googleAccount.googleSubject}
          identity={identity}
          onBack={vi.fn()}
          onDone={vi.fn()}
        />,
        { createGoogleIdentityController: () => controller },
      ),
    );
    await user.click(screen.getByRole("button", { name: "I backed up my pubky" }));
    await user.click(screen.getByRole("button", { name: "Remove Google Access" }));
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.click(screen.getByRole("button", { name: "Confirm deletion" }));

    expect(
      await screen.findByRole("heading", { name: "Drive access required." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/both Google Drive permissions to delete/i)).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /selecting both Google Drive permission checkboxes/i }),
    ).toHaveAttribute("src", "/illustrations/google-drive-permissions.gif");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Continue without visible backup" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(detachIdentity).toHaveBeenCalledTimes(2);
    expect(detachIdentity).toHaveBeenLastCalledWith(
      identity.publicIdentity,
      identity.googleAccount.googleSubject,
    );
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(controller.reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Detach from Google." })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    detachIdentity.mockResolvedValueOnce(Result.ok());
    await user.click(screen.getByRole("button", { name: "Remove Google Access" }));
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.click(screen.getByRole("button", { name: "Confirm deletion" }));
    expect(await screen.findByText(/Google access has been removed/i)).toBeInTheDocument();
  });
});
