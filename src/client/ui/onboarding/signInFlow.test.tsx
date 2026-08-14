/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Result } from "better-result";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  GoogleIdentityFlow,
  GoogleIdentityFlowState,
} from "../../logic/identity/passportIdentityController";
import {
  mockGoogleBackedIdentityFlow,
  mockPassportIdentityController,
} from "../../../../test-utils/fakes/mockPassportIdentityController";
import { SignInFlow } from "./signInFlow";

describe("SignInFlow", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("starts the combined Google authorization from one button click", async () => {
    const continueAction = vi.fn(() => new Promise<never>(() => undefined));
    const controller = mockPassportIdentityController({
      startGoogleIdentityFlow: vi.fn((onState) => {
        onState({ status: "ready" });
        return mockGoogleBackedIdentityFlow({ establishIdentity: continueAction });
      }),
    });

    render(<SignInFlow controller={controller} onComplete={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(continueAction).toHaveBeenCalledWith();
    expect(screen.queryByRole("button", { name: "Continue with Apple" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Requesting Google access." })).toBeInTheDocument();
  });

  it("only shows contextual back navigation when supplied by its parent flow", async () => {
    const onBack = vi.fn();
    const controller = mockPassportIdentityController();

    const rendered = render(<SignInFlow controller={controller} onBack={onBack} onComplete={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();

    rendered.rerender(<SignInFlow controller={controller} onComplete={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("shows the restore branch reported by the controller", async () => {
    let emitState: ((state: GoogleIdentityFlowState) => void) | undefined;
    const controller = mockPassportIdentityController({
      startGoogleIdentityFlow: vi.fn((onState) => {
        emitState = onState;
        onState({ status: "ready" });
        return mockGoogleBackedIdentityFlow();
      }),
    });
    render(<SignInFlow controller={controller} onComplete={vi.fn()} />);
    await waitFor(() => expect(emitState).toBeDefined());
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    act(() => emitState?.({ status: "establishing", progress: "restoring_identity" }));

    expect(await screen.findByRole("heading", { name: "Restoring your pubky." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Setting up your pubky." })).not.toBeInTheDocument();
    expect(await screen.findByText("Restoring your Pubky")).toBeInTheDocument();
    expect(screen.getByText("Restoring your Pubky").closest("li")).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Activate identity").closest("li")).toHaveAttribute("data-state", "pending");
  });

  it("does not claim setup or restore before checking Google Drive", async () => {
    let emitState: ((state: GoogleIdentityFlowState) => void) | undefined;
    const controller = mockPassportIdentityController({
      startGoogleIdentityFlow: vi.fn((onState) => {
        emitState = onState;
        onState({ status: "ready" });
        return mockGoogleBackedIdentityFlow();
      }),
    });
    render(<SignInFlow controller={controller} onComplete={vi.fn()} />);
    await waitFor(() => expect(emitState).toBeDefined());
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

    act(() => emitState?.({ status: "establishing", progress: "checking_passport_file" }));

    expect(await screen.findByRole("heading", { name: "Looking for existing Pubky." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Setting up your pubky." })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Restoring your pubky." })).not.toBeInTheDocument();
  });

  it("shows Google access before identity setup and a recoverable denial", async () => {
    let emitState: ((state: GoogleIdentityFlowState) => void) | undefined;
    const continueAction = vi.fn(async () => Result.err({ code: "authorization_failed" as const }));
    const controller = mockPassportIdentityController({
      startGoogleIdentityFlow: vi.fn((onState) => {
        emitState = onState;
        onState({ status: "ready" });
        return mockGoogleBackedIdentityFlow({ establishIdentity: continueAction });
      }),
    });
    render(<SignInFlow controller={controller} onComplete={vi.fn()} />);
    await waitFor(() => expect(emitState).toBeDefined());
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

    act(() => emitState?.({ status: "requesting-authorization" }));
    expect(await screen.findByRole("heading", { name: "Requesting Google access." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Setting up your pubky." })).not.toBeInTheDocument();

    act(() => emitState?.({ status: "authorization-failed" }));
    expect(await screen.findByRole("heading", { name: "Google access denied." })).toBeInTheDocument();
    const tryAgain = screen.getByRole("button", { name: "Try again" });
    expect(tryAgain.querySelector("[data-slot='rotate-ccw-icon']")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Return home" })).not.toBeInTheDocument();
    await userEvent.setup().click(tryAgain);
    expect(continueAction).toHaveBeenCalledTimes(2);
  });

  it("preserves restored mode through completion", async () => {
    const onComplete = vi.fn();
    const googleAccount = { id: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: null };
    const controller = mockPassportIdentityController({
      startGoogleIdentityFlow: vi.fn((onState) => {
        onState({ status: "ready" });
        return mockGoogleBackedIdentityFlow({
          establishIdentity: vi.fn(async () => Result.ok({
            establishmentMode: "restored" as const,
            googleAccount,
            publicIdentity: { publicKeyZ32: "key", publicKeyDisplay: "pubkykey" },
          })),
        });
      }),
    });
    render(<SignInFlow controller={controller} onComplete={onComplete} />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Continue with Google" }));

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
        establishmentMode: "restored" as const,
        googleAccount,
        publicIdentity: { publicKeyZ32: "key", publicKeyDisplay: "pubkykey" },
      }));
    }));
    const onEstablished = vi.fn();
    const controller = mockPassportIdentityController({
      startGoogleIdentityFlow: vi.fn((onState) => {
        onState({ status: "ready" });
        return mockGoogleBackedIdentityFlow({ establishIdentity });
      }),
    });
    const rendered = render(<SignInFlow controller={controller} onComplete={vi.fn()} onEstablished={onEstablished} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    rendered.unmount();

    finishEstablishment();
    await act(async () => Promise.resolve());

    expect(onEstablished).not.toHaveBeenCalled();
  });

  it("shows the real setup error and resumes an incomplete identity", async () => {
    const googleAccount = { id: "google-1", email: "user@gmail.com", name: "User", pictureUrl: null };
    const publicIdentity = { publicKeyZ32: "key", publicKeyDisplay: "pubkykey" };
    const continueAction = vi.fn()
      .mockResolvedValueOnce(Result.err({
        code: "signin_failed" as const,
        incompleteIdentity: { googleAccount, publicIdentity },
      }))
      .mockResolvedValueOnce(Result.err({ code: "operation_failed" as const }));
    const controller = mockPassportIdentityController({
      startGoogleIdentityFlow: vi.fn((onState) => {
        onState({ status: "ready" });
        return mockGoogleBackedIdentityFlow({
          establishIdentity: continueAction,
          resumeIncompleteIdentity: continueAction,
        });
      }),
    });
    render(<SignInFlow controller={controller} onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Setup interrupted." })).toBeInTheDocument();
    expect(screen.getByText("signin_failed")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Resume setup with this Pubky" }));

    expect(continueAction).toHaveBeenNthCalledWith(2, publicIdentity, googleAccount.id);
  });
});
