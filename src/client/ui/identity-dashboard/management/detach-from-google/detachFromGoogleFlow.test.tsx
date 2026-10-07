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
    await confirmDetachment(user);

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
    await confirmDetachment(user);
    expect(await screen.findByText(/Your Google backup has been removed/i)).toBeInTheDocument();
  });

  it("goes on directly after a recovery file checked or imported earlier", async () => {
    const checkedAt = "2026-09-28T10:00:00.000Z";
    const detachIdentity = vi.fn<GoogleIdentityController["detachIdentity"]>(async () =>
      Result.ok(),
    );
    const user = userEvent.setup();
    renderFlow(mockGoogleIdentityController({ detachIdentity }), {
      ...identity,
      backup: { verifiedAt: checkedAt },
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      `You checked a recovery file of this key on ${formatBackupDate(new Date(checkedAt))}.`,
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue to detach" }));
    expect(screen.getByRole("heading", { name: "Detach from Google." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Detach from Google" }));
    expect(screen.queryByLabelText("Type ONLY COPY to confirm")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).not.toHaveAccessibleDescription(/only copy/u);
    await user.type(screen.getByLabelText("Type DETACH to confirm"), "DETACH");
    await user.click(screen.getByRole("button", { name: "Confirm detachment" }));
    expect(detachIdentity).toHaveBeenCalledOnce();
    expect(await screen.findByText(/Your Google backup has been removed/i)).toBeInTheDocument();
  });

  it("lets Pubky Ring's copy, verified after the export, replace the acknowledgement", async () => {
    const at = new Date(Date.UTC(2026, 9, 1));
    const verifier = {
      start: vi.fn(async () => Result.ok()),
      poll: vi.fn(async () => Result.ok({ status: "verified" as const, at })),
      authorizationUrl: vi.fn(() => "pubkyauth://signin_grant?caps=&secret=s"),
      dispose: vi.fn(),
    };
    const detachIdentity = vi.fn<GoogleIdentityController["detachIdentity"]>(async () =>
      Result.ok(),
    );
    const user = userEvent.setup();
    render(
      withPassportTestProviders(
        <DetachFromGoogleFlow
          createRecoveryFile={vi.fn()}
          verifyRecoveryFile={vi.fn()}
          createMigration={vi.fn(async () => Result.err({ code: "invalid_identity" as const }))}
          googleAccount={identity.googleAccount}
          identity={identity}
          onBack={vi.fn()}
          onDone={vi.fn()}
        />,
        {
          createGoogleIdentityController: () => mockGoogleIdentityController({ detachIdentity }),
          createRingBackupVerifier: () => verifier,
        },
      ),
    );

    await user.click(screen.getByRole("button", { name: "Migrate to Pubky Ring" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    // The check asks Pubky Ring to sign in with this identity's key; once it did, the flow goes
    // back to the backup choice by itself.
    expect(
      await screen.findByRole("heading", { name: "Back up your pubky first." }),
    ).toBeInTheDocument();
    expect(verifier.start).toHaveBeenCalledWith(identity.publicIdentity.publicKeyZ32, "grant");
    expect(screen.getByRole("status")).toHaveTextContent(
      `Pubky Ring signed in with this key on ${formatBackupDate(at)}.`,
    );
    await user.click(screen.getByRole("button", { name: "Continue to detach" }));
    await user.click(screen.getByRole("button", { name: "Detach from Google" }));
    expect(screen.queryByLabelText("Type ONLY COPY to confirm")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Type DETACH to confirm"), "DETACH");
    await user.click(screen.getByRole("button", { name: "Confirm detachment" }));
    expect(detachIdentity).toHaveBeenCalledOnce();
  });

  it("counts a Ring verification recorded earlier like a checked file", async () => {
    const user = userEvent.setup();
    render(
      withPassportTestProviders(
        <DetachFromGoogleFlow
          createRecoveryFile={vi.fn()}
          verifyRecoveryFile={vi.fn()}
          createMigration={vi.fn(async () => Result.err({ code: "invalid_identity" as const }))}
          googleAccount={identity.googleAccount}
          identity={{ ...identity, backup: { ringVerifiedAt: "2026-09-01T10:00:00.000Z" } }}
          onBack={vi.fn()}
          onDone={vi.fn()}
        />,
        { createGoogleIdentityController: () => mockGoogleIdentityController() },
      ),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      `Pubky Ring signed in with this key on ${formatBackupDate(new Date("2026-09-01T10:00:00.000Z"))}.`,
    );
    await user.click(screen.getByRole("button", { name: "Continue to detach" }));
    await user.click(screen.getByRole("button", { name: "Detach from Google" }));
    expect(screen.queryByLabelText("Type ONLY COPY to confirm")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Type DETACH to confirm")).toBeInTheDocument();
  });

  it("deletes the Drive backup of an unchecked key only after the typed acknowledgement", async () => {
    const detachIdentity = vi.fn<GoogleIdentityController["detachIdentity"]>(async () =>
      Result.ok(),
    );
    const controller = mockGoogleIdentityController({ detachIdentity });
    const user = userEvent.setup();
    renderFlow(controller);

    // A recovery file Passport only made was never seen to open, so it does not count.
    expect(screen.getByRole("status")).toHaveTextContent(
      "No backup of this key has been verified.",
    );
    await user.click(screen.getByRole("button", { name: "Continue to detach" }));
    await user.click(screen.getByRole("button", { name: "Detach from Google" }));
    const dialog = screen.getByRole("dialog", { name: "Detach from Google?" });
    expect(dialog).toHaveAccessibleDescription(
      /^No backup of this key has been verified, so this browser will keep the only copy of your key\./u,
    );
    expect(screen.queryByLabelText("Type DETACH to confirm")).not.toBeInTheDocument();
    const acknowledgement = screen.getByLabelText("Type ONLY COPY to confirm");
    const confirm = within(dialog).getByRole("button", { name: "Confirm detachment" });

    await user.type(acknowledgement, "DETACH{Enter}");
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(detachIdentity).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("idle");

    // Cancelling forgets what was typed; the next attempt starts from an empty field.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Detach from Google" }));
    expect(screen.getByLabelText("Type ONLY COPY to confirm")).toHaveValue("");
    expect(detachIdentity).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Type ONLY COPY to confirm"), "ONLY COPY");
    await user.click(screen.getByRole("button", { name: "Confirm detachment" }));
    expect(detachIdentity).toHaveBeenCalledOnce();
    expect(detachIdentity).toHaveBeenCalledWith(
      identity.publicIdentity,
      identity.googleAccount.googleSubject,
    );
    expect(await screen.findByText(/Your Google backup has been removed/i)).toBeInTheDocument();
  });

  it("lets a recovery file checked here replace the acknowledgement, and not a skipped Ring check", async () => {
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

    // Ring cannot report an import, so skipping its check still leads to the typed acknowledgement.
    await user.click(screen.getByRole("button", { name: "Migrate to Pubky Ring" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Verify your backup." })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(screen.getByRole("status")).toHaveTextContent(/you’ll type ONLY COPY to confirm/u);

    await user.click(screen.getByRole("button", { name: "Download recovery file" }));
    await user.type(screen.getByLabelText("Enter strong password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Download recovery file" }));
    await user.upload(
      screen.getByLabelText("Recovery file"),
      new File([new Uint8Array([1, 2, 3])], "pubky-identity.pkarr"),
    );
    await user.type(screen.getByLabelText("Recovery file password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Verify recovery file" }));

    expect(
      await screen.findByRole("heading", { name: "Back up your pubky first." }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ONLY COPY/u)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue to detach" }));
    expect(screen.getByRole("heading", { name: "Detach from Google." })).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Attached Google account: user@example.com" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Detach from Google" }));
    expect(screen.getByLabelText("Type DETACH to confirm")).toBeInTheDocument();
    expect(screen.queryByLabelText("Type ONLY COPY to confirm")).not.toBeInTheDocument();
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

function renderFlow(
  controller: ReturnType<typeof mockGoogleIdentityController>,
  detachedIdentity: Parameters<typeof DetachFromGoogleFlow>[0]["identity"] = identity,
) {
  render(
    withPassportTestProviders(
      <DetachFromGoogleFlow
        createRecoveryFile={vi.fn()}
        verifyRecoveryFile={vi.fn()}
        createMigration={vi.fn()}
        googleAccount={identity.googleAccount}
        identity={detachedIdentity}
        onBack={vi.fn()}
        onDone={vi.fn()}
      />,
      { createGoogleIdentityController: () => controller },
    ),
  );
}

/** Detaches a key with no checked recovery file, which takes the typed acknowledgement. */
async function confirmDetachment(user: ReturnType<typeof userEvent.setup>) {
  if (screen.queryByRole("button", { name: "Continue to detach" })) {
    await user.click(screen.getByRole("button", { name: "Continue to detach" }));
  }
  await user.click(screen.getByRole("button", { name: "Detach from Google" }));
  await user.type(screen.getByLabelText("Type ONLY COPY to confirm"), "ONLY COPY");
  await user.click(screen.getByRole("button", { name: "Confirm detachment" }));
}
