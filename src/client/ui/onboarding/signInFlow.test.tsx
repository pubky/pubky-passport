/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  GoogleIdentityFlow,
  GoogleIdentityFlowState,
} from "../../logic/google-identity/GoogleIdentityFlow";
import { mockGoogleIdentityFlow } from "../../../../test-utils/fakes/mockGoogleIdentityFlow";
import { SignInFlow } from "./signInFlow";

const MOCKS = vi.hoisted(() => ({
  constructGoogleIdentityFlow: vi.fn(),
}));

vi.mock("../../logic/google-identity/GoogleIdentityFlow", () => ({
  GoogleIdentityFlow: function GoogleIdentityFlow(
    configuration: unknown,
    onState: (state: GoogleIdentityFlowState) => void,
  ) {
    return MOCKS.constructGoogleIdentityFlow(configuration, onState);
  },
}));

const GOOGLE_PROPS = {
  googleIdentityConfiguration: {
    googleClientId: "google-client-id",
    homegateBaseUrl: "https://homegate.example/",
  },
};

describe("SignInFlow", () => {
  beforeEach(() => {
    MOCKS.constructGoogleIdentityFlow.mockImplementation(() => mockGoogleIdentityFlow());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps Google authorization disabled before the screen flow is mounted", () => {
    const markup = renderToStaticMarkup(
      <SignInFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />,
    );
    const shell = document.createElement("div");
    shell.innerHTML = markup;
    const googleButton = [...shell.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Continue with Google"));

    expect(googleButton).toBeDisabled();
    expect(MOCKS.constructGoogleIdentityFlow).not.toHaveBeenCalled();
  });

  it("starts Google authorization from one button click", async () => {
    const establishIdentity = vi.fn(() => new Promise<never>(() => undefined));
    useFlow(mockGoogleIdentityFlow({ establishIdentity }));

    render(<SignInFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />);
    const continueWithGoogle = screen.getByRole("button", { name: "Continue with Google" });
    await waitFor(() => expect(continueWithGoogle).toBeEnabled());
    await userEvent.setup().click(continueWithGoogle);

    expect(establishIdentity).toHaveBeenCalledWith();
    expect(screen.queryByRole("button", { name: "Continue with Apple" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Requesting Google access." })).toBeInTheDocument();
  });

  it("only shows contextual back navigation when supplied by its parent flow", async () => {
    const onBack = vi.fn();
    const rendered = render(<SignInFlow {...GOOGLE_PROPS} onBack={onBack} onComplete={vi.fn()} />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();

    rendered.rerender(<SignInFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("shows the restore branch reported by the flow", async () => {
    const emitState = captureFlowState(mockGoogleIdentityFlow({
      establishIdentity: vi.fn(() => new Promise<never>(() => undefined)),
    }));
    render(<SignInFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    act(() => emitState.current?.({ status: "establishing", progress: "restoring_identity" }));

    expect(await screen.findByRole("heading", { name: "Restoring your pubky." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Setting up your pubky." })).not.toBeInTheDocument();
    expect(screen.getByText("Restoring your Pubky").closest("li")).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Activate identity").closest("li")).toHaveAttribute("data-state", "pending");

    act(() => emitState.current?.({ status: "establishing", progress: "repairing_restored_identity" }));
    expect(screen.getByText("Activate identity").closest("li")).toHaveAttribute("data-state", "active");
  });

  it("does not claim setup or restore before checking Google Drive", async () => {
    const emitState = captureFlowState(mockGoogleIdentityFlow({
      establishIdentity: vi.fn(() => new Promise<never>(() => undefined)),
    }));
    render(<SignInFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    act(() => emitState.current?.({ status: "establishing", progress: "checking_passport_file" }));

    expect(await screen.findByRole("heading", { name: "Looking for existing Pubky." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Setting up your pubky." })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Restoring your pubky." })).not.toBeInTheDocument();
  });

  it("shows Google access before a recoverable denial", async () => {
    let deny!: () => void;
    const establishIdentity = vi.fn(() => new Promise<Awaited<ReturnType<GoogleIdentityFlow["establishIdentity"]>>>((resolve) => {
      deny = () => resolve(Result.err({ code: "authorization_failed" }));
    }));
    useFlow(mockGoogleIdentityFlow({ establishIdentity }));
    render(<SignInFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />);

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
    const googleAccount = { id: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: null };
    useFlow(mockGoogleIdentityFlow({
      establishIdentity: vi.fn(async () => Result.ok({
        establishmentMode: "restored" as const,
        googleAccount,
        publicIdentity: { publicKeyZ32: "key", publicKeyDisplay: "pubkykey" },
      })),
    }));
    render(<SignInFlow {...GOOGLE_PROPS} onComplete={onComplete} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("heading", { name: "Restore complete." })).toBeInTheDocument();
    expect(screen.getByText("Satoshi Nakamoto")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("does not deliver completion after the flow unmounts", async () => {
    let finishEstablishment!: () => void;
    const googleAccount = { id: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: null };
    const establishIdentity = vi.fn(() => new Promise<Awaited<ReturnType<GoogleIdentityFlow["establishIdentity"]>>>((resolve) => {
      finishEstablishment = () => resolve(Result.ok({
        establishmentMode: "restored",
        googleAccount,
        publicIdentity: { publicKeyZ32: "key", publicKeyDisplay: "pubkykey" },
      }));
    }));
    useFlow(mockGoogleIdentityFlow({ establishIdentity }));
    const onEstablished = vi.fn();
    const rendered = render(<SignInFlow {...GOOGLE_PROPS} onComplete={vi.fn()} onEstablished={onEstablished} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    rendered.unmount();

    finishEstablishment();
    await act(async () => Promise.resolve());
    expect(onEstablished).not.toHaveBeenCalled();
  });

  it("shows the setup error and retries automatic reconciliation", async () => {
    const establishIdentity = vi.fn()
      .mockResolvedValueOnce(Result.err({ code: "signin_failed" as const }))
      .mockResolvedValueOnce(Result.err({ code: "operation_failed" as const }));
    useFlow(mockGoogleIdentityFlow({ establishIdentity }));
    render(<SignInFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("heading", { name: "Setup interrupted." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(establishIdentity).toHaveBeenNthCalledWith(2);
  });

  it("shows the specific safe operation error and cause", async () => {
    useFlow(mockGoogleIdentityFlow({
      establishIdentity: vi.fn(async () => Result.err({
        code: "homeserver_signup_invitation_failed" as const,
        cause: "weekly_limit_exceeded" as const,
      })),
    }));
    render(<SignInFlow {...GOOGLE_PROPS} onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByText("Passport could not obtain a homeserver signup invitation.")).toBeInTheDocument();
    expect(screen.getByText("homeserver_signup_invitation_failed")).toBeInTheDocument();
    expect(screen.getByText("weekly_limit_exceeded")).toBeInTheDocument();
  });
});

function useFlow(flow: GoogleIdentityFlow): void {
  MOCKS.constructGoogleIdentityFlow.mockReturnValue(flow);
}

function captureFlowState(flow: GoogleIdentityFlow): { current?: (state: GoogleIdentityFlowState) => void } {
  const capture: { current?: (state: GoogleIdentityFlowState) => void } = {};
  MOCKS.constructGoogleIdentityFlow.mockImplementation((_, onState) => {
    capture.current = onState;
    return flow;
  });
  return capture;
}
