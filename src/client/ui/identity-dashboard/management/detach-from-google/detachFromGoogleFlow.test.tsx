/** @vitest-environment jsdom */

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { mockGoogleIdentityController } from "@test-utils/mockGoogleIdentityController";
import type { GoogleIdentityController } from "@/client/logic/google-identity/GoogleIdentityController";
import { formatBackupDate } from "@/client/ui/identity-dashboard/backupStatus";
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
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

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
          googleAccount={identity.googleAccount}
          identity={identity}
          onBack={vi.fn()}
          onDone={vi.fn()}
        />,
        { createGoogleIdentityController: () => controller },
      ),
    );
    await acknowledgeBackup(user);
    await user.click(screen.getByRole("button", { name: "Detach from Google…" }));
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
    expect(screen.queryByRole("button", { name: "Skip the folder copy" })).not.toBeInTheDocument();

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
    await user.click(screen.getByRole("button", { name: "Detach from Google…" }));
    await user.type(screen.getByLabelText("Type DETACH to confirm"), "DETACH");
    await user.click(screen.getByRole("button", { name: "Confirm detachment" }));
    expect(await screen.findByText(/Your Google backup has been removed/i)).toBeInTheDocument();
  });

  it("names a recovery file this browser recorded as checked, and still asks for the acknowledgement", async () => {
    const checkedAt = "2026-09-28T10:00:00.000Z";
    render(
      withPassportTestProviders(
        <DetachFromGoogleFlow
          createRecoveryFile={vi.fn()}
          verifyRecoveryFile={vi.fn()}
          createMigration={vi.fn()}
          googleAccount={identity.googleAccount}
          identity={{ ...identity, backup: { verifiedAt: checkedAt } }}
          onBack={vi.fn()}
          onDone={vi.fn()}
        />,
        { createGoogleIdentityController: () => mockGoogleIdentityController() },
      ),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      `You checked a recovery file of this key on ${formatBackupDate(new Date(checkedAt))}.`,
    );
    expect(screen.getByRole("button", { name: "Continue to detach" })).toBeDisabled();
    await acknowledgeBackup(userEvent.setup());
    expect(screen.getByRole("heading", { name: "Detach from Google." })).toBeInTheDocument();
  });

  it("opens the way on after a recovery file checked here, and not after Pubky Ring", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const createRecoveryFile = vi.fn(async () =>
      Result.ok({ bytes: new Uint8Array([1, 2, 3]), fileName: "pubky-identity.pkarr" }),
    );
    const verifyRecoveryFile = vi.fn(async () => Result.ok());
    const user = userEvent.setup();
    render(
      withPassportTestProviders(
        <DetachFromGoogleFlow
          createRecoveryFile={createRecoveryFile}
          verifyRecoveryFile={verifyRecoveryFile}
          createMigration={vi.fn(async () => Result.err({ code: "invalid_identity" as const }))}
          googleAccount={identity.googleAccount}
          identity={identity}
          onBack={vi.fn()}
          onDone={vi.fn()}
        />,
        { createGoogleIdentityController: () => mockGoogleIdentityController() },
      ),
    );

    // Ring cannot report an import, so returning from it still needs the acknowledgement.
    await user.click(screen.getByRole("button", { name: "Use in Pubky Ring" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Continue to detach" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Download encrypted backup" }));
    await user.type(screen.getByLabelText("Enter strong password"), "correct horse battery");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Download backup" }));
    await user.upload(
      screen.getByLabelText("Recovery file"),
      new File([new Uint8Array([1, 2, 3])], "pubky-identity.pkarr"),
    );
    await user.type(screen.getByLabelText("Recovery file password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Verify recovery file" }));

    expect(
      await screen.findByRole("heading", { name: "Back up your pubky first." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue to detach" }));
    expect(screen.getByRole("heading", { name: "Detach from Google." })).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Attached Google account: user@example.com" }),
    ).toBeVisible();
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
    const dialog = screen.getByRole("dialog", { name: "Detach from Google?" });
    expect(within(dialog).getByRole("button", { name: "Detaching…" })).toHaveAttribute(
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
        googleAccount={identity.googleAccount}
        identity={identity}
        onBack={vi.fn()}
        onDone={vi.fn()}
      />,
      { createGoogleIdentityController: () => controller },
    ),
  );
}

async function acknowledgeBackup(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("checkbox", { name: /^I have this pubky in Pubky Ring/u }));
  await user.click(screen.getByRole("button", { name: "Continue to detach" }));
}

async function confirmDetachment(user: ReturnType<typeof userEvent.setup>) {
  if (screen.queryByRole("button", { name: "Continue to detach" })) {
    await acknowledgeBackup(user);
  }
  await user.click(screen.getByRole("button", { name: "Detach from Google…" }));
  await user.type(screen.getByLabelText("Type DETACH to confirm"), "DETACH");
  await user.click(screen.getByRole("button", { name: "Confirm detachment" }));
}
