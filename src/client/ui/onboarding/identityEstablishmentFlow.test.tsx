/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mockGoogleIdentityController,
  type MockGoogleIdentityController,
} from "@test-utils/mockGoogleIdentityController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { LOGGER } from "@/libs/logger/logger";
import type { PassportCollaborators } from "@/client/ui/passportCollaborators";
import { IdentityEstablishmentFlow } from "./identityEstablishmentFlow";

const MOCKS = {
  constructGoogleIdentityController:
    vi.fn<PassportCollaborators["createGoogleIdentityController"]>(),
};
const COLLABORATORS: Partial<PassportCollaborators> = {
  createGoogleIdentityController: MOCKS.constructGoogleIdentityController,
};

function ConfiguredIdentityEstablishmentFlow({
  forAuthorization,
  onComplete,
}: {
  forAuthorization?: boolean | undefined;
  onComplete: () => void;
}) {
  return withPassportTestProviders(
    <IdentityEstablishmentFlow
      forAuthorization={forAuthorization}
      onComplete={onComplete}
      renderEntry={(startGoogle) => (
        <main>
          <h1>Entry</h1>
          <button onClick={startGoogle} type="button">
            Continue with Google
          </button>
        </main>
      )}
    />,
    COLLABORATORS,
  );
}

describe("IdentityEstablishmentFlow", () => {
  beforeEach(() => {
    MOCKS.constructGoogleIdentityController.mockImplementation(() =>
      mockGoogleIdentityController(),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the parent's entry screen without constructing browser dependencies on the server", () => {
    const markup = renderToStaticMarkup(
      <ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />,
    );
    // Attached so accessible names that resolve through aria-labelledby can be computed.
    const shell = document.body.appendChild(document.createElement("div"));
    shell.innerHTML = markup;
    const googleButton = within(shell).getByRole("button", { name: "Continue with Google" });

    expect(within(shell).getByRole("heading", { name: "Entry" })).toHaveTextContent("Entry");
    expect(googleButton).toBeEnabled();
    expect(MOCKS.constructGoogleIdentityController).not.toHaveBeenCalled();
    shell.remove();
  });

  it("starts Google authorization from one button click", async () => {
    const establishIdentity = vi.fn(() => new Promise<never>(() => undefined));
    useController(mockGoogleIdentityController({ establishIdentity }));

    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);
    const continueWithGoogle = screen.getByRole("button", { name: "Continue with Google" });
    await waitFor(() => expect(continueWithGoogle).toBeEnabled());
    await userEvent.setup().click(continueWithGoogle);

    expect(establishIdentity).toHaveBeenCalledWith();
    expect(screen.queryByRole("button", { name: "Continue with Apple" })).not.toBeInTheDocument();
    const requestingHeading = screen.getByRole("heading", {
      name: "Requesting Google Drive access.",
    });
    expect(within(requestingHeading).getByText("Drive")).toHaveClass("hidden", "md:inline");
    expect(requestingHeading.querySelector("br")).toHaveClass("hidden", "md:block");
    expect(requestingHeading.lastElementChild).toHaveTextContent("access.");
    expect(requestingHeading.lastElementChild).toHaveClass("md:inline");
    expect(requestingHeading.parentElement).toHaveClass("gap-6", "md:gap-3");
    expect(requestingHeading.closest("main")).toHaveClass("gap-6", "md:gap-8");
    const waiting = screen.getByRole("button", { name: "Waiting for Google..." });
    expect(waiting).toBeDisabled();
    expect(waiting).toHaveClass("w-full", "h-15", "bg-secondary", "disabled:opacity-50");
    expect(
      within(screen.getByRole("status")).getByText("Waiting for Google..."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });

  it("uses the authorization action width when embedded in that flow", async () => {
    useController(
      mockGoogleIdentityController({
        establishIdentity: vi.fn(() => new Promise<never>(() => undefined)),
      }),
    );
    render(<ConfiguredIdentityEstablishmentFlow forAuthorization onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(screen.getByRole("button", { name: "Waiting for Google..." })).not.toHaveClass(
      "md:w-[220px]",
    );
  });

  it("keeps a restore on the loading screen and announces a repair", async () => {
    const controller = mockGoogleIdentityController({
      establishIdentity: vi.fn(() => new Promise<never>(() => undefined)),
    });
    useController(controller);
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    act(() =>
      controller.emitState({
        status: "establishing",
        progress: { flow: "restore", step: "restoring" },
      }),
    );

    expect(await screen.findByRole("heading", { name: "Loading your pubky." })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Setting up your pubky." }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your Pubky.");
    expect(screen.queryByText("Republish PKDNS records")).not.toBeInTheDocument();

    act(() =>
      controller.emitState({
        status: "establishing",
        progress: { flow: "repair", step: "signing_up" },
      }),
    );
    expect(screen.getByRole("heading", { name: "Repairing your pubky." })).toBeInTheDocument();
    const repairProgress = screen.getByRole("list", { name: "Pubky identity repair progress" });
    expect(
      within(repairProgress).getByText("Restore encrypted backup").closest("li"),
    ).toHaveTextContent("Restore encrypted backup (complete)");
    expect(
      within(repairProgress).getByText("Repair homeserver access").closest("li"),
    ).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Repairing your Pubky: Repair homeserver access.",
    );
  });

  it("does not claim setup or restore before checking Google Drive", async () => {
    const controller = mockGoogleIdentityController({
      establishIdentity: vi.fn(() => new Promise<never>(() => undefined)),
    });
    useController(controller);
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    act(() =>
      controller.emitState({
        status: "establishing",
        progress: { flow: "lookup", step: "checking" },
      }),
    );

    expect(await screen.findByRole("heading", { name: "Loading your pubky." })).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Setting up your pubky." }),
    ).not.toBeInTheDocument();
  });

  it("shows setup interrupted after Google access is rejected", async () => {
    let deny!: () => void;
    const establishIdentity = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<MockGoogleIdentityController["establishIdentity"]>>>(
          (resolve) => {
            deny = () => resolve(Result.err({ code: "google_authorization_denied" }));
          },
        ),
    );
    useController(mockGoogleIdentityController({ establishIdentity }));
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(
      screen.getByRole("heading", { name: "Requesting Google Drive access." }),
    ).toBeInTheDocument();
    act(deny);

    const deniedHeading = await screen.findByRole("heading", {
      name: "Google Drive access denied.",
    });
    expect(deniedHeading).toHaveFocus();
    expect(
      screen.getByRole("img", { name: /selecting both Google Drive permission checkboxes/i }),
    ).toHaveAttribute("src", "/illustrations/google-drive-permissions.gif");
    expect(within(deniedHeading).getByText("Drive")).toHaveClass("hidden", "md:inline");
    expect(
      screen.getByText("Passport needs Google Drive access to create or restore your Pubky."),
    ).toHaveClass("md:hidden");
    expect(
      screen.getByText(
        "Passport needs access to your Google Drive to create or restore your Pubky.",
      ),
    ).toHaveClass("hidden", "md:inline");
    expect(screen.queryByText("Technical details")).not.toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    const tryAgain = screen.getByRole("button", { name: "Try again" });
    // One action row for every viewport: back first, the recovery action last.
    expect(buttons).toEqual([screen.getByRole("button", { name: "Back" }), tryAgain]);
    await userEvent.setup().click(tryAgain);
    expect(establishIdentity).toHaveBeenCalledTimes(2);
  });

  it("finishes a restored identity without a completion screen", async () => {
    const onComplete = vi.fn();
    const googleAccount = {
      googleSubject: "google-1",
      email: "satoshi@gmail.com",
      name: "Satoshi Nakamoto",
      pictureUrl: null,
    };
    useController(
      mockGoogleIdentityController({
        establishIdentity: vi.fn(async () =>
          Result.ok({
            establishmentMode: "restored" as const,
            googleAccount,
            publicIdentity: { publicKeyZ32: "key" },
          }),
        ),
      }),
    );
    render(<ConfiguredIdentityEstablishmentFlow onComplete={onComplete} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(screen.queryByRole("heading", { name: "Restore complete." })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Backup ready." })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  });

  it("explains missing required Drive access before setup and offers a retry", async () => {
    const establishIdentity = vi.fn(async () =>
      Result.err({ code: "google_drive_access_required" as const }),
    );
    useController(mockGoogleIdentityController({ establishIdentity }));
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(
      await screen.findByRole("heading", { name: "Drive access required." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /selecting both Google Drive permission checkboxes/i }),
    ).toHaveAttribute("src", "/illustrations/google-drive-permissions.gif");
    expect(
      screen.queryByRole("button", { name: "Continue without visible backup" }),
    ).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(establishIdentity).toHaveBeenCalledTimes(2);
  });

  it("lets a partial grant continue without the visible backup", async () => {
    const continueWithoutVisibleBackup = vi.fn(async () =>
      Result.ok({
        establishmentMode: "created" as const,
        googleAccount: {
          googleSubject: "google-1",
          email: "user@example.com",
          name: "User",
          pictureUrl: null,
        },
        publicIdentity: { publicKeyZ32: "new-key" },
        visibleRecoveryCopyStatus: "skipped" as const,
      }),
    );
    useController(
      mockGoogleIdentityController({
        establishIdentity: vi.fn(async () =>
          Result.err({ code: "visible_backup_permission_missing" as const }),
        ),
        continueWithoutVisibleBackup,
      }),
    );
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(
      await screen.findByRole("heading", { name: "Drive access optional." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/it won’t create a visible backup/i)).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Continue without visible backup" }));
    expect(continueWithoutVisibleBackup).toHaveBeenCalledOnce();
    expect(await screen.findByText(/No visible recovery copy was created/i)).toBeInTheDocument();
  });

  it("shows the setup error and retries automatic reconciliation", async () => {
    const establishIdentity = vi
      .fn()
      .mockResolvedValueOnce(Result.err({ code: "signin_failed" as const }))
      .mockResolvedValueOnce(Result.err({ code: "operation_failed" as const }));
    useController(mockGoogleIdentityController({ establishIdentity }));
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("heading", { name: "Setup interrupted." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(establishIdentity).toHaveBeenNthCalledWith(2);
  });

  it("confirms permanent invalid-file deletion and automatically creates a new identity", async () => {
    const googleAccount = {
      googleSubject: "google-1",
      email: "user@example.com",
      name: "User",
      pictureUrl: null,
    };
    const replaceInvalidPassportFile = vi.fn(async () =>
      Result.ok({
        establishmentMode: "created" as const,
        googleAccount,
        publicIdentity: { publicKeyZ32: "new-key" },
        visibleRecoveryCopyStatus: "created" as const,
      }),
    );
    useController(
      mockGoogleIdentityController({
        establishIdentity: vi.fn(async () =>
          Result.err({ code: "invalid_passport_file" as const }),
        ),
        replaceInvalidPassportFile,
      }),
    );
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Setup interrupted." })).toBeInTheDocument();
    expect(screen.getByText("invalid_passport_file").closest("details")).not.toHaveAttribute(
      "open",
    );
    expect(
      screen.getByText(
        "Delete the damaged file and create a new pubky, or go back and choose another Google account.",
      ),
    ).toBeVisible();
    // A damaged file stays damaged, so Try again is not offered as the way out.
    const deleteBackup = screen.getByRole("button", { name: "Delete backup & create new pubky" });
    const back = screen.getByRole("button", { name: "Back" });
    expect(screen.getAllByRole("button")).toEqual([back, deleteBackup]);
    // Deleting is a secondary, destructive option below the navigation.
    expect(deleteBackup).toHaveClass("text-destructive-text");
    await user.click(deleteBackup);

    const confirmation = screen.getByRole("textbox", { name: "Type DELETE to confirm" });
    const replace = screen.getByRole("button", { name: "Delete and create new identity" });
    expect(confirmation).toHaveFocus();
    expect(replace).toBeDisabled();
    await user.type(confirmation, "DELETE");
    expect(replace).toBeEnabled();
    await user.click(replace);

    expect(replaceInvalidPassportFile).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", { name: "Backup ready." })).toBeInTheDocument();
  });

  it("offers to delete an own-origin identity file Passport cannot decrypt and creates a new identity", async () => {
    const googleAccount = {
      googleSubject: "google-account",
      email: "user@example.com",
      name: "User",
      pictureUrl: null,
    };
    const replaceInvalidPassportFile = vi.fn(async () =>
      Result.err({ code: "operation_failed" as const }),
    );
    const replaceUndecryptablePassportFile = vi
      .fn()
      .mockResolvedValueOnce(
        Result.err({ code: "undecryptable_passport_file_delete_failed" as const }),
      )
      .mockResolvedValueOnce(
        Result.ok({
          establishmentMode: "created" as const,
          googleAccount,
          publicIdentity: { publicKeyZ32: "new-key" },
          visibleRecoveryCopyStatus: "created" as const,
        }),
      );
    useController(
      mockGoogleIdentityController({
        establishIdentity: vi.fn(async () =>
          Result.err({ code: "passport_file_undecryptable" as const }),
        ),
        replaceInvalidPassportFile,
        replaceUndecryptablePassportFile,
      }),
    );
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Setup interrupted." })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Passport found your encrypted identity file in Google Drive, but can no longer unlock it with this Google account.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("passport_file_undecryptable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete backup & create new pubky" }));

    expect(
      screen.getByText(/no longer be recoverable from this Google account/),
    ).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Type DELETE to confirm" }), "DELETE");
    await user.click(screen.getByRole("button", { name: "Delete and create new identity" }));

    expect(replaceUndecryptablePassportFile).toHaveBeenCalledOnce();
    expect(replaceInvalidPassportFile).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "Passport could not delete the identity file it cannot decrypt from Google Drive. You can try deleting it again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("undecryptable_passport_file_delete_failed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete backup & create new pubky" }));
    expect(
      screen.getByText("Passport could not delete the identity file. Please try again."),
    ).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Type DELETE to confirm" }), "DELETE");
    await user.click(screen.getByRole("button", { name: "Delete and create new identity" }));

    expect(replaceUndecryptablePassportFile).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("heading", { name: "Backup ready." })).toBeInTheDocument();
  });

  it("resets the controller when returning from an establishment failure", async () => {
    const establishIdentity = vi
      .fn()
      .mockResolvedValueOnce(Result.err({ code: "signin_failed" as const }))
      .mockImplementationOnce(() => new Promise<never>(() => undefined));
    const controller = mockGoogleIdentityController({ establishIdentity });
    useController(controller);
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("heading", { name: "Setup interrupted." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));

    expect(controller.reset).toHaveBeenCalledOnce();
    expect(MOCKS.constructGoogleIdentityController).toHaveBeenCalledOnce();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(establishIdentity).toHaveBeenCalledTimes(2);
  });

  it("renders the safe detail code returned by the controller", async () => {
    useController(
      mockGoogleIdentityController({
        establishIdentity: vi.fn(async () =>
          Result.err({
            code: "homeserver_signup_token_failed" as const,
            detailCode: "weekly_limit_exceeded" as const,
          }),
        ),
      }),
    );
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(
      await screen.findByText("Passport could not obtain a homeserver invitation."),
    ).toBeInTheDocument();
    // Codes are for support: collapsed technical details, not an input-like box.
    const summary = screen.getByText("Technical details");
    expect(summary.tagName).toBe("SUMMARY");
    const details = summary.closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent(
      "Error code: homeserver_signup_token_failed · weekly_limit_exceeded",
    );
    // The limit is the actionable cause, so it is the visible next step, not only a code.
    expect(screen.getByRole("heading", { name: "Setup interrupted." })).toHaveAccessibleDescription(
      "Passport could not obtain a homeserver invitation. This Google account has reached its weekly limit for new identities. Try again in a week, or go back and create your account another way.",
    );
    // Trying again now cannot succeed, so Back is the only way on.
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Back"]);
  });

  it("contains rejected operation details outside hook state and logs safe metadata", async () => {
    const thrown = { secret: "ESTABLISHMENT-HOOK-CANARY" };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    useController(
      mockGoogleIdentityController({
        establishIdentity: vi.fn().mockRejectedValue(thrown),
      }),
    );
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Setup interrupted." })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("ESTABLISHMENT-HOOK-CANARY");
    expect(JSON.stringify(warning.mock.calls)).not.toContain("ESTABLISHMENT-HOOK-CANARY");
  });

  it("contains controller construction details outside hook state", async () => {
    const thrown = { secret: "ESTABLISHMENT-CONSTRUCTOR-CANARY" };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    MOCKS.constructGoogleIdentityController.mockImplementationOnce(() => {
      throw thrown;
    });

    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("heading", { name: "Setup interrupted." })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("ESTABLISHMENT-CONSTRUCTOR-CANARY");
    expect(warning).toHaveBeenCalledWith("identity.google.establishment_ui.failed", {
      operation: "construct_controller",
      diagnosticId: expect.any(String),
      errorName: "ErrorLike",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("ESTABLISHMENT-CONSTRUCTOR-CANARY");
  });

  it("retries controller construction when the user tries again", async () => {
    const googleAccount = {
      googleSubject: "google-1",
      email: "user@example.com",
      name: "User",
      pictureUrl: null,
    };
    const recoveredController = mockGoogleIdentityController({
      establishIdentity: vi.fn(async () =>
        Result.ok({
          establishmentMode: "created" as const,
          googleAccount,
          publicIdentity: { publicKeyZ32: "key" },
          visibleRecoveryCopyStatus: "created" as const,
        }),
      ),
    });
    MOCKS.constructGoogleIdentityController
      .mockImplementationOnce(() => {
        throw new Error("temporarily unavailable");
      })
      .mockReturnValue(recoveredController);
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Backup ready." })).toBeInTheDocument();
    expect(MOCKS.constructGoogleIdentityController).toHaveBeenCalledTimes(2);
  });

  it("warns when a visible recovery copy could not be confirmed", async () => {
    useController(
      mockGoogleIdentityController({
        establishIdentity: vi.fn(async () =>
          Result.ok({
            establishmentMode: "created" as const,
            googleAccount: {
              googleSubject: "google-1",
              email: "user@example.com",
              name: "User",
              pictureUrl: null,
            },
            publicIdentity: { publicKeyZ32: "key" },
            visibleRecoveryCopyStatus: "unconfirmed" as const,
          }),
        ),
      }),
    );
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Passport could not confirm the visible recovery copy",
    );
  });

  it("describes a final PKDNS publication failure without stale resolution language", async () => {
    useController(
      mockGoogleIdentityController({
        establishIdentity: vi.fn(async () => Result.err({ code: "publication_failed" as const })),
      }),
    );
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(
      await screen.findByText("Passport could not publish your identity's PKDNS records."),
    ).toBeInTheDocument();
  });
});

function useController(controller: MockGoogleIdentityController): void {
  MOCKS.constructGoogleIdentityController.mockReturnValue(controller);
}
