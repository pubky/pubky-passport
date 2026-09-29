/** @vitest-environment jsdom */

import { act, cleanup, render, screen, within } from "@testing-library/react";
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
          verifyRecoveryFile={vi.fn()}
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
    await user.type(screen.getByLabelText("Type DETACH to confirm"), "DETACH");
    await user.click(screen.getByRole("button", { name: "Confirm detachment" }));

    expect(
      await screen.findByRole("heading", { name: "Drive access required." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/both Google Drive permissions to delete/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /both Google Drive boxes ticked/ })).toHaveAttribute(
      "src",
      "/illustrations/google-drive-permissions-still.png",
    );
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
    await user.type(screen.getByLabelText("Type DETACH to confirm"), "DETACH");
    await user.click(screen.getByRole("button", { name: "Confirm detachment" }));
    expect(await screen.findByText(/Your Google backup has been removed/i)).toBeInTheDocument();
  });

  it("waits for Google's window with Cancel and Show, and removes nothing until Google answers", async () => {
    let answer: (
      result: Awaited<ReturnType<GoogleIdentityController["detachIdentity"]>>,
    ) => void = () => undefined;
    const detachIdentity = vi.fn<GoogleIdentityController["detachIdentity"]>(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const controller = mockGoogleIdentityController({ detachIdentity });
    const user = userEvent.setup();
    renderFlow(controller);
    await confirmDetachment(user);

    // Nothing is removed while Google's window is open, so the person can stop or find it.
    expect(
      screen.getByRole("heading", { name: "Requesting Google Drive access." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for Google…");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show Google’s window" }));
    expect(controller.showAuthorizationWindow).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(controller.cancelAuthorization).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Detach from Google." })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Once Google answers, the confirmation shows the removal in progress.
    await confirmDetachment(user);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for Google…");
    act(() => controller.emitState({ status: "detaching" }));
    const dialog = screen.getByRole("dialog", { name: "Remove Google Access" });
    expect(within(dialog).getByRole("button", { name: "Removing…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    answer(Result.ok());
    expect(await screen.findByText(/Your Google backup has been removed/i)).toBeInTheDocument();
  });
});

function renderFlow(controller: ReturnType<typeof mockGoogleIdentityController>) {
  render(
    withPassportTestProviders(
      <DetachFromGoogleFlow
        createRecoveryFile={vi.fn()}
        verifyRecoveryFile={vi.fn()}
        createMigration={vi.fn()}
        googleSubject={identity.googleAccount.googleSubject}
        identity={identity}
        onBack={vi.fn()}
        onDone={vi.fn()}
      />,
      { createGoogleIdentityController: () => controller },
    ),
  );
}

async function confirmDetachment(user: ReturnType<typeof userEvent.setup>) {
  if (screen.queryByRole("button", { name: "I backed up my pubky" })) {
    await user.click(screen.getByRole("button", { name: "I backed up my pubky" }));
  }
  await user.click(screen.getByRole("button", { name: "Remove Google Access" }));
  await user.type(screen.getByLabelText("Type DETACH to confirm"), "DETACH");
  await user.click(screen.getByRole("button", { name: "Confirm detachment" }));
}
