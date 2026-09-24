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
  onBack,
  onComplete,
}: {
  forAuthorization?: boolean | undefined;
  onBack?: (() => void) | undefined;
  onComplete: () => void;
}) {
  return withPassportTestProviders(
    <IdentityEstablishmentFlow
      forAuthorization={forAuthorization}
      onBack={onBack}
      onComplete={onComplete}
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

  it("renders without constructing browser dependencies on the server", () => {
    const markup = renderToStaticMarkup(
      <ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />,
    );
    const shell = document.createElement("div");
    shell.innerHTML = markup;
    const googleButton = [...shell.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Continue with Google"),
    );

    expect(within(shell).getByRole("heading", { name: "Quick & easy signing." })).toHaveTextContent(
      "Quick & easy",
    );
    expect(
      within(shell).getByRole("heading", { name: "Quick & easy signing." }).lastElementChild,
    ).toHaveClass("md:block");
    expect(googleButton).toBeEnabled();
    expect(googleButton?.parentElement).toHaveClass("md:col-start-1", "md:row-start-1");
    expect(MOCKS.constructGoogleIdentityController).not.toHaveBeenCalled();
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

  it("only shows contextual back navigation when supplied by its parent flow", async () => {
    const onBack = vi.fn();
    const rendered = render(
      <ConfiguredIdentityEstablishmentFlow onBack={onBack} onComplete={vi.fn()} />,
    );

    const back = await screen.findByRole("button", { name: "Back" });
    expect(back).toHaveClass("md:mt-auto");
    await userEvent.setup().click(back);
    expect(onBack).toHaveBeenCalledOnce();

    rendered.rerender(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("shows the restore branch reported by the flow", async () => {
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

    expect(
      await screen.findByRole("heading", { name: "Restoring your pubky." }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Setting up your pubky." }),
    ).not.toBeInTheDocument();
    const restoreProgress = screen.getByRole("list", { name: "Pubky identity restore progress" });
    expect(
      within(restoreProgress).getByText("Restore encrypted backup").closest("li"),
    ).toHaveAttribute("aria-current", "step");
    expect(
      within(restoreProgress).getByText("Sign in to the homeserver").closest("li"),
    ).toHaveTextContent("Sign in to the homeserver (pending)");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Restoring your Pubky: Restore encrypted backup.",
    );
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

    expect(
      await screen.findByRole("heading", { name: "Looking for existing Pubky." }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Setting up your pubky." }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Restoring your pubky." }),
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
    expect(
      screen.getByRole("img", { name: /selecting both Google Drive permission checkboxes/i }),
    ).toHaveAttribute("src", "/illustrations/google-drive-permissions.gif");
    expect(within(deniedHeading).getByText("Drive")).toHaveClass("hidden", "md:inline");
    expect(deniedHeading.parentElement).toHaveClass("gap-6", "md:gap-3");
    expect(
      screen.getByText("Passport needs Google Drive access to create or restore your Pubky."),
    ).toHaveClass("md:hidden");
    expect(
      screen.getByText(
        "Passport needs access to your Google Drive to create or restore your Pubky.",
      ),
    ).toHaveClass("hidden", "md:block");
    expect(screen.queryByRole("group", { name: "Error" })).not.toBeInTheDocument();
    const mobileActions = screen.getByRole("group", { name: "Mobile error actions" });
    const desktopActions = screen.getByRole("group", { name: "Desktop error actions" });
    const mobileTryAgain = within(mobileActions).getByRole("button", { name: "Try again" });
    const mobileBack = within(mobileActions).getByRole("button", { name: "Back" });
    const desktopBack = within(desktopActions).getByRole("button", { name: "Back" });
    const desktopTryAgain = within(desktopActions).getByRole("button", { name: "Try again" });
    expect(within(mobileActions).getAllByRole("button")).toEqual([mobileTryAgain, mobileBack]);
    expect(within(desktopActions).getAllByRole("button")).toEqual([desktopBack, desktopTryAgain]);
    expect(mobileActions).toHaveClass("mt-auto", "md:hidden");
    expect(desktopActions).toHaveClass("hidden", "md:grid");
    await userEvent.setup().click(mobileTryAgain);
    expect(establishIdentity).toHaveBeenCalledTimes(2);
  });

  it("preserves restored mode through completion", async () => {
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
    expect(await screen.findByRole("heading", { name: "Restore complete." })).toBeInTheDocument();
    expect(screen.getByText("Satoshi Nakamoto")).toBeInTheDocument();
    expect(screen.getByText("satoshi@gmail.com")).toHaveClass("uppercase");
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(onComplete).toHaveBeenCalledOnce();
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
    await userEvent.setup().click(
      within(screen.getByRole("group", { name: "Mobile error actions" })).getByRole("button", {
        name: "Try again",
      }),
    );
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
    expect(
      within(screen.getByRole("group", { name: "Error" })).getByText("invalid_passport_file"),
    ).toBeInTheDocument();
    const mobileActions = screen.getByRole("group", { name: "Mobile error actions" });
    const desktopActions = screen.getByRole("group", { name: "Desktop error actions" });
    const mobileTryAgain = within(mobileActions).getByRole("button", { name: "Try again" });
    const mobileDelete = within(mobileActions).getByRole("button", {
      name: "Delete backup & create new pubky",
    });
    const mobileBack = within(mobileActions).getByRole("button", { name: "Back" });
    const desktopDelete = within(desktopActions).getByRole("button", {
      name: "Delete & create new",
    });
    const desktopTryAgain = within(desktopActions).getByRole("button", { name: "Try again" });
    const desktopBack = within(desktopActions).getByRole("button", { name: "Back" });
    expect(within(mobileActions).getAllByRole("button")).toEqual([
      mobileTryAgain,
      mobileDelete,
      mobileBack,
    ]);
    expect(within(desktopActions).getAllByRole("button")).toEqual([
      desktopBack,
      desktopDelete,
      desktopTryAgain,
    ]);
    expect(mobileActions).toHaveClass("mt-auto", "md:hidden");
    expect(mobileActions.parentElement).toHaveClass("min-h-0", "flex-1");
    expect(desktopActions).toHaveClass(
      "hidden",
      "md:grid",
      "grid-cols-(--passport-error-actions-columns)",
      "md:gap-x-6",
    );
    expect(mobileDelete).toHaveClass("bg-destructive-surface", "text-destructive-foreground");
    expect(desktopDelete).toHaveClass(
      "bg-destructive-surface",
      "text-destructive-foreground",
      "md:col-start-2",
      "md:row-start-1",
    );
    expect(desktopTryAgain).toHaveClass("md:col-start-3", "md:row-start-1");
    expect(desktopBack).toHaveClass("md:col-start-1", "md:row-start-1");
    await user.click(mobileDelete);

    const confirmation = screen.getByRole("textbox", { name: "Type DELETE to confirm" });
    const replace = screen.getByRole("button", { name: "Delete and create new identity" });
    expect(confirmation).toHaveFocus();
    expect(replace).toBeDisabled();
    await user.type(confirmation, "DELETE");
    expect(replace).toBeEnabled();
    await user.click(replace);

    expect(replaceInvalidPassportFile).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", { name: "Setup complete." })).toBeInTheDocument();
  });

  it("offers to delete an identity file Passport cannot decrypt and creates a new identity", async () => {
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
        establishIdentity: vi.fn(async () => Result.err({ code: "decrypt_failed" as const })),
        replaceInvalidPassportFile,
        replaceUndecryptablePassportFile,
      }),
    );
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Setup interrupted." })).toBeInTheDocument();
    expect(
      screen.getByText("Passport found your encrypted identity, but could not decrypt it."),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Error" })).getByText("decrypt_failed"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Mobile error actions" })).getByRole("button", {
        name: "Delete backup & create new pubky",
      }),
    ).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("group", { name: "Desktop error actions" })).getByRole("button", {
        name: "Delete & create new",
      }),
    );

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
    expect(
      within(screen.getByRole("group", { name: "Error" })).getByText(
        "undecryptable_passport_file_delete_failed",
      ),
    ).toBeInTheDocument();

    await user.click(
      within(screen.getByRole("group", { name: "Desktop error actions" })).getByRole("button", {
        name: "Delete & create new",
      }),
    );
    expect(
      screen.getByText("Passport could not delete the identity file. Please try again."),
    ).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Type DELETE to confirm" }), "DELETE");
    await user.click(screen.getByRole("button", { name: "Delete and create new identity" }));

    expect(replaceUndecryptablePassportFile).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("heading", { name: "Setup complete." })).toBeInTheDocument();
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
    await userEvent.setup().click(
      within(screen.getByRole("group", { name: "Mobile error actions" })).getByRole("button", {
        name: "Back",
      }),
    );

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
    const errorDetails = screen.getByRole("group", { name: "Error" });
    expect(errorDetails).toHaveClass("border-dashed", "border-input", "min-h-14");
    expect(errorDetails).not.toContainElement(screen.getByText("Error"));
    expect(within(errorDetails).getByText("homeserver_signup_token_failed")).toBeInTheDocument();
    expect(within(errorDetails).getByText("weekly_limit_exceeded")).toBeInTheDocument();
    const mobileActions = screen.getByRole("group", { name: "Mobile error actions" });
    const desktopActions = screen.getByRole("group", { name: "Desktop error actions" });
    expect(
      within(mobileActions)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Try again", "Back"]);
    expect(
      within(desktopActions)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Back", "Try again"]);
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
    await userEvent
      .setup()
      .click(
        within(await screen.findByRole("group", { name: "Mobile error actions" })).getByRole(
          "button",
          { name: "Try again" },
        ),
      );

    expect(await screen.findByRole("heading", { name: "Setup complete." })).toBeInTheDocument();
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
