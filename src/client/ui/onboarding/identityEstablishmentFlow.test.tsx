/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  GoogleIdentityViewState,
} from "../../logic/google-identity/GoogleIdentityController";
import {
  mockGoogleIdentityController,
  type MockGoogleIdentityController,
} from "../../../../test-utils/mockGoogleIdentityController";
import { withGoogleIdentityConfiguration } from "../../../../test-utils/googleIdentityConfiguration";
import { LOGGER } from "../../../libs/logger/logger";
import { IdentityEstablishmentFlow } from "./identityEstablishmentFlow";

const MOCKS = vi.hoisted(() => ({
  constructGoogleIdentityController: vi.fn(),
}));

vi.mock("../../logic/google-identity/GoogleIdentityController", () => ({
  GoogleIdentityController: class {
    constructor(
      googleClientId: string,
      homegateBaseUrl: string,
      onState: (state: GoogleIdentityViewState) => void,
    ) {
      return MOCKS.constructGoogleIdentityController(googleClientId, homegateBaseUrl, onState);
    }
  },
}));

function ConfiguredIdentityEstablishmentFlow({ onBack, onComplete }: {
  onBack?: () => void;
  onComplete: () => void;
}) {
  return withGoogleIdentityConfiguration(
    <IdentityEstablishmentFlow
      {...(onBack ? { onBack } : {})}
      onComplete={onComplete}
    />,
  );
}

describe("IdentityEstablishmentFlow", () => {
  beforeEach(() => {
    MOCKS.constructGoogleIdentityController.mockImplementation(() => mockGoogleIdentityController());
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
    const googleButton = [...shell.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Continue with Google"));

    expect(within(shell).getByRole("heading", { name: "Quick & easy signing." })).toHaveTextContent("Quick & easy");
    expect(googleButton).toBeEnabled();
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
    expect(screen.getByRole("heading", { name: "Requesting Google access." })).toBeInTheDocument();
    const waiting = screen.getByRole("button", { name: "Waiting for Google..." });
    expect(waiting).toBeDisabled();
    expect(waiting).toHaveClass("w-full", "h-[60px]", "bg-secondary", "disabled:opacity-50");
    expect(within(screen.getByRole("status")).getByText("Waiting for Google...")).toBeInTheDocument();
  });

  it("only shows contextual back navigation when supplied by its parent flow", async () => {
    const onBack = vi.fn();
    const rendered = render(<ConfiguredIdentityEstablishmentFlow onBack={onBack} onComplete={vi.fn()} />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();

    rendered.rerender(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("shows the restore branch reported by the flow", async () => {
    const emitState = captureControllerState(mockGoogleIdentityController({
      establishIdentity: vi.fn(() => new Promise<never>(() => undefined)),
    }));
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    act(() => emitState.current?.({ status: "establishing", progress: { flow: "restore", step: "restoring" } }));

    expect(await screen.findByRole("heading", { name: "Restoring your pubky." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Setting up your pubky." })).not.toBeInTheDocument();
    const restoreProgress = screen.getByRole("list", { name: "Pubky identity restore progress" });
    expect(within(restoreProgress).getByText("Restore Passport file").closest("li")).toHaveAttribute("aria-current", "step");
    expect(within(restoreProgress).getByText("Sign in to the homeserver").closest("li")).toHaveTextContent("Sign in to the homeserver (pending)");
    expect(screen.getByRole("status")).toHaveTextContent("Restoring your Pubky: Restore Passport file.");
    expect(screen.queryByText("Republish PKDNS records")).not.toBeInTheDocument();

    act(() => emitState.current?.({ status: "establishing", progress: { flow: "repair", step: "signing_up" } }));
    expect(screen.getByRole("heading", { name: "Repairing your pubky." })).toBeInTheDocument();
    const repairProgress = screen.getByRole("list", { name: "Pubky identity repair progress" });
    expect(within(repairProgress).getByText("Restore Passport file").closest("li")).toHaveTextContent("Restore Passport file (complete)");
    expect(within(repairProgress).getByText("Repair homeserver access").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("status")).toHaveTextContent("Repairing your Pubky: Repair homeserver access.");
  });

  it("does not claim setup or restore before checking Google Drive", async () => {
    const emitState = captureControllerState(mockGoogleIdentityController({
      establishIdentity: vi.fn(() => new Promise<never>(() => undefined)),
    }));
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    act(() => emitState.current?.({ status: "establishing", progress: { flow: "lookup", step: "checking" } }));

    expect(await screen.findByRole("heading", { name: "Looking for existing Pubky." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Setting up your pubky." })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Restoring your pubky." })).not.toBeInTheDocument();
  });

  it("shows setup interrupted after Google access is rejected", async () => {
    let deny!: () => void;
    const establishIdentity = vi.fn(() => new Promise<Awaited<ReturnType<MockGoogleIdentityController["establishIdentity"]>>>((resolve) => {
      deny = () => resolve(Result.err({ code: "google_authorization_denied" }));
    }));
    useController(mockGoogleIdentityController({ establishIdentity }));
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(screen.getByRole("heading", { name: "Requesting Google access." })).toBeInTheDocument();
    act(deny);

    expect(await screen.findByRole("heading", { name: "Setup interrupted." })).toBeInTheDocument();
    expect(screen.getByText("Google access was denied. Passport needs Google Drive access to create or restore your Pubky.")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Error" })).getByText("google_authorization_denied")).toBeInTheDocument();
    const tryAgain = screen.getByRole("button", { name: "Try again" });
    await userEvent.setup().click(tryAgain);
    expect(establishIdentity).toHaveBeenCalledTimes(2);
  });

  it("preserves restored mode through completion", async () => {
    const onComplete = vi.fn();
    const googleAccount = { googleSubject: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: null };
    useController(mockGoogleIdentityController({
      establishIdentity: vi.fn(async () => Result.ok({
        establishmentMode: "restored" as const,
        googleAccount,
        publicIdentity: { publicKeyZ32: "key",},
      })),
    }));
    render(<ConfiguredIdentityEstablishmentFlow onComplete={onComplete} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("heading", { name: "Restore complete." })).toBeInTheDocument();
    expect(screen.getByText("Satoshi Nakamoto")).toBeInTheDocument();
    expect(screen.getByText("satoshi@gmail.com")).toHaveClass("normal-case");
    expect(screen.getByText("satoshi@gmail.com")).not.toHaveClass("uppercase");
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("shows the setup error and retries automatic reconciliation", async () => {
    const establishIdentity = vi.fn()
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
    const googleAccount = { googleSubject: "google-1", email: "user@example.com", name: "User", pictureUrl: null };
    const replaceInvalidPassportFile = vi.fn(async () => Result.ok({
      establishmentMode: "created" as const,
      googleAccount,
      publicIdentity: { publicKeyZ32: "new-key",},
      visibleRecoveryCopyStatus: "created" as const,
    }));
    useController(mockGoogleIdentityController({
      establishIdentity: vi.fn(async () => Result.err({ code: "invalid_passport_file" as const })),
      replaceInvalidPassportFile,
    }));
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Setup interrupted." })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Error" })).getByText("invalid_passport_file")).toBeInTheDocument();
    const tryAgain = screen.getByRole("button", { name: "Try again" });
    const deleteFile = screen.getByRole("button", { name: "Delete file and create new identity" });
    const back = screen.getByRole("button", { name: "Back" });
    expect(within(deleteFile.parentElement!).getAllByRole("button")).toEqual([tryAgain, deleteFile, back]);
    expect(deleteFile).toHaveClass("bg-destructive-surface", "text-destructive-foreground");
    await user.click(deleteFile);

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

  it("clears the pinned Google account when returning from an establishment failure", async () => {
    const clearPinnedGoogleSubject = vi.fn();
    const establishIdentity = vi.fn()
      .mockResolvedValueOnce(Result.err({ code: "signin_failed" as const }))
      .mockImplementationOnce(() => new Promise<never>(() => undefined));
    useController(mockGoogleIdentityController({
      clearPinnedGoogleSubject,
      establishIdentity,
    }));
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("heading", { name: "Setup interrupted." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));

    expect(clearPinnedGoogleSubject).toHaveBeenCalledOnce();
    expect(MOCKS.constructGoogleIdentityController).toHaveBeenCalledOnce();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(establishIdentity).toHaveBeenCalledTimes(2);
  });

  it("renders the safe detail code returned by the controller", async () => {
    useController(mockGoogleIdentityController({
      establishIdentity: vi.fn(async () => Result.err({
        code: "homeserver_signup_invitation_failed" as const,
        detailCode: "weekly_limit_exceeded" as const,
      })),
    }));
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByText("Passport could not obtain a homeserver signup invitation.")).toBeInTheDocument();
    const errorDetails = screen.getByRole("group", { name: "Error" });
    expect(errorDetails).toHaveClass("border-dashed", "border-input", "min-h-[60px]");
    expect(errorDetails).not.toContainElement(screen.getByText("Error"));
    expect(within(errorDetails).getByText("homeserver_signup_invitation_failed")).toBeInTheDocument();
    expect(within(errorDetails).getByText("weekly_limit_exceeded")).toBeInTheDocument();
  });

  it("contains rejected operation details outside hook state and logs safe metadata", async () => {
    const thrown = { secret: "ESTABLISHMENT-HOOK-CANARY" };
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    useController(mockGoogleIdentityController({
      establishIdentity: vi.fn().mockRejectedValue(thrown),
    }));
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Continue with Google" }));

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
    expect(JSON.stringify(warning.mock.calls)).not.toContain("ESTABLISHMENT-CONSTRUCTOR-CANARY");
  });

  it("retries controller construction when the user tries again", async () => {
    const googleAccount = { googleSubject: "google-1", email: "user@example.com", name: "User", pictureUrl: null };
    const recoveredController = mockGoogleIdentityController({
      establishIdentity: vi.fn(async () => Result.ok({
        establishmentMode: "created" as const,
        googleAccount,
        publicIdentity: { publicKeyZ32: "key",},
        visibleRecoveryCopyStatus: "created" as const,
      })),
    });
    MOCKS.constructGoogleIdentityController
      .mockImplementationOnce(() => { throw new Error("temporarily unavailable"); })
      .mockReturnValue(recoveredController);
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Setup complete." })).toBeInTheDocument();
    expect(MOCKS.constructGoogleIdentityController).toHaveBeenCalledTimes(2);
  });

  it("warns when a visible recovery copy could not be confirmed", async () => {
    useController(mockGoogleIdentityController({
      establishIdentity: vi.fn(async () => Result.ok({
        establishmentMode: "created" as const,
        googleAccount: { googleSubject: "google-1", email: "user@example.com", name: "User", pictureUrl: null },
        publicIdentity: { publicKeyZ32: "key",},
        visibleRecoveryCopyStatus: "unconfirmed" as const,
      })),
    }));
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Passport could not confirm the visible recovery copy",
    );
  });

  it("describes a final PKDNS publication failure without stale resolution language", async () => {
    useController(mockGoogleIdentityController({
      establishIdentity: vi.fn(async () => Result.err({ code: "publication_failed" as const })),
    }));
    render(<ConfiguredIdentityEstablishmentFlow onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByText("Passport could not publish your identity's PKDNS records.")).toBeInTheDocument();
  });
});

function useController(controller: MockGoogleIdentityController): void {
  MOCKS.constructGoogleIdentityController.mockReturnValue(controller);
}

function captureControllerState(controller: MockGoogleIdentityController): { current?: (state: GoogleIdentityViewState) => void } {
  const capture: { current?: (state: GoogleIdentityViewState) => void } = {};
  MOCKS.constructGoogleIdentityController.mockImplementation((_, __, onState) => {
    capture.current = onState;
    return controller;
  });
  return capture;
}
