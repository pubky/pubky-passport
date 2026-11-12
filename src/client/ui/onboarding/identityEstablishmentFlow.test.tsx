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
  onBack,
  onComplete,
}: {
  onBack?: (() => void) | undefined;
  onComplete: () => void;
}) {
  return withPassportTestProviders(
    <IdentityEstablishmentFlow onBack={onBack} onComplete={onComplete} />,
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
    // Attached so accessible names that resolve through aria-labelledby can be computed.
    const shell = document.body.appendChild(document.createElement("div"));
    shell.innerHTML = markup;
    const googleButton = within(shell).getByRole("button", { name: "Continue with Google" });

    expect(within(shell).getByRole("heading", { name: "Quick access." })).toHaveTextContent(
      "Quick",
    );
    expect(googleButton).toBeEnabled();
    expect(googleButton.parentElement).toHaveClass("relative", "w-full");
    expect(within(shell).getByRole("button", { name: "How?" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // The only links are the notice's (Terms, Privacy, Pubky protocol), opening in a new tab.
    expect(
      within(shell)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("target")]),
    ).toEqual([
      ["Terms of Service", "/terms-of-service", "_blank"],
      ["Privacy Policy", "/privacy-policy", "_blank"],
      ["Pubky protocol", "https://pubky.org/", "_blank"],
    ]);
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
      name: "Requesting Google access.",
    });
    expect(requestingHeading.lastElementChild).toHaveTextContent("access.");
    expect(requestingHeading.parentElement).toHaveClass("gap-6");
    expect(requestingHeading.closest("main")).toHaveClass("gap-6");
    const waiting = screen.getByRole("button", { name: "Waiting for Google..." });
    expect(waiting).toBeDisabled();
    expect(waiting).toHaveClass("w-full", "h-15", "bg-secondary", "disabled:opacity-50");
    expect(
      within(screen.getByRole("status")).getByText("Waiting for Google..."),
    ).toBeInTheDocument();
  });

  it("only shows contextual back navigation when supplied by its parent flow", async () => {
    const onBack = vi.fn();
    const rendered = render(
      <ConfiguredIdentityEstablishmentFlow onBack={onBack} onComplete={vi.fn()} />,
    );

    const back = await screen.findByRole("button", { name: "Back" });
    await userEvent.setup().click(back);
    expect(onBack).toHaveBeenCalledOnce();

    rendered.rerender(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("heading", { name: "Requesting Google access." })).toBeInTheDocument();
    act(deny);

    const deniedHeading = await screen.findByRole("heading", {
      name: "Google access denied.",
    });
    expect(
      screen.getByRole("img", { name: /selecting both Google Drive permission checkboxes/i }),
    ).toHaveAttribute("src", "/illustrations/google-drive-permissions.gif");
    expect(deniedHeading.parentElement).toHaveClass("gap-6");
    expect(
      screen.getByText("Passport needs Google Drive access to create or restore your Pubky."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Error" })).not.toBeInTheDocument();
    // One set of actions at every width.
    const actions = screen.getByRole("group", { name: "Error actions" });
    const tryAgain = within(actions).getByRole("button", { name: "Continue with Google" });
    const back = within(actions).getByRole("button", { name: "Back" });
    expect(within(actions).getAllByRole("button", { name: /^(?!How )/u })).toEqual([
      tryAgain,
      back,
    ]);
    expect(actions).toHaveClass("mt-auto");
    expect(actions.className).not.toMatch(/md:/u);
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
    expect(screen.queryByRole("heading", { name: "Setup complete." })).not.toBeInTheDocument();
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
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
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
      within(screen.getByRole("group", { name: "Error actions" })).getByRole("button", {
        name: "Continue with Google",
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
    // One set of actions at every width.
    expect(screen.getAllByRole("group", { name: "Error actions" })).toHaveLength(1);
    const actions = screen.getByRole("group", { name: "Error actions" });
    const tryAgain = within(actions).getByRole("button", { name: "Continue with Google" });
    const deleteAndCreate = within(actions).getByRole("button", {
      name: "Delete backup & create new pubky",
    });
    const back = within(actions).getByRole("button", { name: "Back" });
    expect(within(actions).getAllByRole("button", { name: /^(?!How )/u })).toEqual([
      tryAgain,
      deleteAndCreate,
      back,
    ]);
    expect(actions).toHaveClass("mt-auto", "grid-cols-1");
    expect(actions.className).not.toMatch(/md:/u);
    expect(actions.parentElement).toHaveClass("min-h-0", "flex-1");
    expect(deleteAndCreate).toHaveClass("bg-destructive-surface", "text-destructive-foreground");
    await user.click(deleteAndCreate);

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
      within(screen.getByRole("group", { name: "Error actions" })).getByRole("button", {
        name: "Delete backup & create new pubky",
      }),
    ).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("group", { name: "Error actions" })).getByRole("button", {
        name: "Delete backup & create new pubky",
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
      within(screen.getByRole("group", { name: "Error actions" })).getByRole("button", {
        name: "Delete backup & create new pubky",
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
      within(screen.getByRole("group", { name: "Error actions" })).getByRole("button", {
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
    const actions = screen.getByRole("group", { name: "Error actions" });
    expect(
      within(actions)
        .getAllByRole("button", { name: /^(?!How )/u })
        .map((button) => button.textContent),
    ).toEqual(["Continue with Google", "Back"]);
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
    await userEvent.setup().click(
      within(await screen.findByRole("group", { name: "Error actions" })).getByRole("button", {
        name: "Continue with Google",
      }),
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
