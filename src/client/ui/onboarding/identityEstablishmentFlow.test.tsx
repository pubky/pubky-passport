/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  GoogleIdentityController,
  GoogleIdentityViewState,
} from "../../logic/google-identity/GoogleIdentityController";
import { mockGoogleIdentityController } from "../../../../test-utils/fakes/mockGoogleIdentityController";
import { IdentityEstablishmentFlow } from "./identityEstablishmentFlow";

const MOCKS = vi.hoisted(() => ({
  constructGoogleIdentityController: vi.fn(),
}));

vi.mock("../../logic/google-identity/GoogleIdentityController", () => ({
  GoogleIdentityController: function GoogleIdentityController(
    configuration: unknown,
    onState: (state: GoogleIdentityViewState) => void,
  ) {
    return MOCKS.constructGoogleIdentityController(configuration, onState);
  },
}));

const GOOGLE_PROPS = {
  googleIdentityConfiguration: {
    googleClientId: "google-client-id",
    homegateBaseUrl: "https://homegate.example/",
  },
};

describe("IdentityEstablishmentFlow", () => {
  beforeEach(() => {
    MOCKS.constructGoogleIdentityController.mockImplementation(() => mockGoogleIdentityController());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps Google authorization disabled before the screen flow is mounted", () => {
    const markup = renderToStaticMarkup(
      <IdentityEstablishmentFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />,
    );
    const shell = document.createElement("div");
    shell.innerHTML = markup;
    const googleButton = [...shell.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Continue with Google"));

    expect(googleButton).toBeDisabled();
    expect(MOCKS.constructGoogleIdentityController).not.toHaveBeenCalled();
  });

  it("starts Google authorization from one button click", async () => {
    const establishIdentity = vi.fn(() => new Promise<never>(() => undefined));
    useController(mockGoogleIdentityController({ establishIdentity }));

    render(<IdentityEstablishmentFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />);
    const continueWithGoogle = screen.getByRole("button", { name: "Continue with Google" });
    await waitFor(() => expect(continueWithGoogle).toBeEnabled());
    await userEvent.setup().click(continueWithGoogle);

    expect(establishIdentity).toHaveBeenCalledWith();
    expect(screen.queryByRole("button", { name: "Continue with Apple" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Requesting Google access." })).toBeInTheDocument();
  });

  it("only shows contextual back navigation when supplied by its parent flow", async () => {
    const onBack = vi.fn();
    const rendered = render(<IdentityEstablishmentFlow {...GOOGLE_PROPS} onBack={onBack} onComplete={vi.fn()} />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();

    rendered.rerender(<IdentityEstablishmentFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("shows the restore branch reported by the flow", async () => {
    const emitState = captureControllerState(mockGoogleIdentityController({
      establishIdentity: vi.fn(() => new Promise<never>(() => undefined)),
    }));
    render(<IdentityEstablishmentFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    act(() => emitState.current?.({ status: "establishing", progress: { flow: "restore", step: "restoring" } }));

    expect(await screen.findByRole("heading", { name: "Restoring your pubky." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Setting up your pubky." })).not.toBeInTheDocument();
    expect(screen.getByText("Restore Passport file").closest("li")).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Sign in to the homeserver").closest("li")).toHaveAttribute("data-state", "pending");
    expect(screen.queryByText("Republish PKDNS records")).not.toBeInTheDocument();

    act(() => emitState.current?.({ status: "establishing", progress: { flow: "repair", step: "signing_up" } }));
    expect(screen.getByRole("heading", { name: "Repairing your pubky." })).toBeInTheDocument();
    expect(screen.getByText("Restore Passport file").closest("li")).toHaveAttribute("data-state", "complete");
    expect(screen.getByText("Repair homeserver access").closest("li")).toHaveAttribute("data-state", "active");
  });

  it("does not claim setup or restore before checking Google Drive", async () => {
    const emitState = captureControllerState(mockGoogleIdentityController({
      establishIdentity: vi.fn(() => new Promise<never>(() => undefined)),
    }));
    render(<IdentityEstablishmentFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    act(() => emitState.current?.({ status: "establishing", progress: { flow: "lookup", step: "checking" } }));

    expect(await screen.findByRole("heading", { name: "Looking for existing Pubky." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Setting up your pubky." })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Restoring your pubky." })).not.toBeInTheDocument();
  });

  it("shows Google access before a recoverable denial", async () => {
    let deny!: () => void;
    const establishIdentity = vi.fn(() => new Promise<Awaited<ReturnType<GoogleIdentityController["establishIdentity"]>>>((resolve) => {
      deny = () => resolve(Result.err({ code: "google_authorization_denied" }));
    }));
    useController(mockGoogleIdentityController({ establishIdentity }));
    render(<IdentityEstablishmentFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(screen.getByRole("heading", { name: "Requesting Google access." })).toBeInTheDocument();
    act(deny);

    expect(await screen.findByRole("heading", { name: "Google access denied." })).toBeInTheDocument();
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
        publicIdentity: { publicKeyZ32: "key", publicKeyDisplay: "pubkykey" },
      })),
    }));
    render(<IdentityEstablishmentFlow {...GOOGLE_PROPS} onComplete={onComplete} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("heading", { name: "Restore complete." })).toBeInTheDocument();
    expect(screen.getByText("Satoshi Nakamoto")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("shows the setup error and retries automatic reconciliation", async () => {
    const establishIdentity = vi.fn()
      .mockResolvedValueOnce(Result.err({ code: "signin_failed" as const }))
      .mockResolvedValueOnce(Result.err({ code: "operation_failed" as const }));
    useController(mockGoogleIdentityController({ establishIdentity }));
    render(<IdentityEstablishmentFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("heading", { name: "Setup interrupted." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(establishIdentity).toHaveBeenNthCalledWith(2);
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
    render(<IdentityEstablishmentFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("heading", { name: "Setup interrupted." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));

    expect(clearPinnedGoogleSubject).toHaveBeenCalledOnce();
    expect(MOCKS.constructGoogleIdentityController).toHaveBeenCalledOnce();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(establishIdentity).toHaveBeenCalledTimes(2);
  });

  it("shows the specific safe operation error and cause", async () => {
    useController(mockGoogleIdentityController({
      establishIdentity: vi.fn(async () => Result.err({
        code: "homeserver_signup_invitation_failed" as const,
        cause: "weekly_limit_exceeded" as const,
      })),
    }));
    render(<IdentityEstablishmentFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByText("Passport could not obtain a homeserver signup invitation.")).toBeInTheDocument();
    expect(screen.getByText("homeserver_signup_invitation_failed")).toBeInTheDocument();
    expect(screen.getByText("weekly_limit_exceeded")).toBeInTheDocument();
  });

  it("describes a final PKDNS publication failure without stale resolution language", async () => {
    useController(mockGoogleIdentityController({
      establishIdentity: vi.fn(async () => Result.err({ code: "publication_failed" as const })),
    }));
    render(<IdentityEstablishmentFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByText("Passport could not publish your identity's PKDNS records.")).toBeInTheDocument();
  });
});

function useController(controller: GoogleIdentityController): void {
  MOCKS.constructGoogleIdentityController.mockReturnValue(controller);
}

function captureControllerState(controller: GoogleIdentityController): { current?: (state: GoogleIdentityViewState) => void } {
  const capture: { current?: (state: GoogleIdentityViewState) => void } = {};
  MOCKS.constructGoogleIdentityController.mockImplementation((_, onState) => {
    capture.current = onState;
    return controller;
  });
  return capture;
}
