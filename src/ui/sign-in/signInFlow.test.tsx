/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Result } from "better-result";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GoogleBackedIdentityActionState } from "../../browser/identity/passportIdentity";
import { mockPassportIdentityController } from "../../../test-utils/fakes/mockPassportIdentityController";
import { SignInFlow } from "./signInFlow";

describe("SignInFlow", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("starts the combined Google authorization from one button click", async () => {
    const continueAction = vi.fn(async () => ({ status: "busy" as const }));
    const controller = mockPassportIdentityController({
      prepareGoogleAuthorization: vi.fn(async (onState) => onState({ stage: "google-authorization", errorCode: null })),
      continueGoogleBackedIdentityAction: continueAction,
    });

    render(<SignInFlow controller={controller} onComplete={vi.fn()} onSetupStarted={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(continueAction).toHaveBeenCalledWith({ kind: "establish_google_backed_identity" });
    expect(screen.queryByRole("button", { name: "Continue with Apple" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Requesting Google access." })).toBeInTheDocument();
  });

  it("shows the restore branch reported by the controller", async () => {
    let emitState: ((state: GoogleBackedIdentityActionState) => void) | undefined;
    const controller = mockPassportIdentityController({
      continueGoogleBackedIdentityAction: vi.fn(async () => ({ status: "busy" as const })),
      prepareGoogleAuthorization: vi.fn(async (onState) => {
        emitState = onState;
        onState({ stage: "google-authorization", errorCode: null });
      }),
    });
    render(<SignInFlow controller={controller} onComplete={vi.fn()} onSetupStarted={vi.fn()} />);
    await waitFor(() => expect(emitState).toBeDefined());
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    act(() => emitState?.({ stage: "establishing-google-backed-identity", progress: "restoring_identity" }));

    expect(await screen.findByRole("heading", { name: "Restoring your pubky." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Setting up your pubky." })).not.toBeInTheDocument();
    expect(await screen.findByText("Restoring your Pubky")).toBeInTheDocument();
    expect(screen.getByText("Restoring your Pubky").closest("li")).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Activate identity").closest("li")).toHaveAttribute("data-state", "pending");
  });

  it("does not claim setup or restore before checking Google Drive", async () => {
    let emitState: ((state: GoogleBackedIdentityActionState) => void) | undefined;
    const controller = mockPassportIdentityController({
      continueGoogleBackedIdentityAction: vi.fn(async () => ({ status: "busy" as const })),
      prepareGoogleAuthorization: vi.fn(async (onState) => {
        emitState = onState;
        onState({ stage: "google-authorization", errorCode: null });
      }),
    });
    render(<SignInFlow controller={controller} onComplete={vi.fn()} onSetupStarted={vi.fn()} />);
    await waitFor(() => expect(emitState).toBeDefined());
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

    act(() => emitState?.({ stage: "establishing-google-backed-identity", progress: "checking_passport_file" }));

    expect(await screen.findByRole("heading", { name: "Looking for existing Pubky." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Setting up your pubky." })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Restoring your pubky." })).not.toBeInTheDocument();
  });

  it("shows Google access before identity setup and a recoverable denial", async () => {
    let emitState: ((state: GoogleBackedIdentityActionState) => void) | undefined;
    const continueAction = vi.fn(async () => ({ status: "busy" as const }));
    const controller = mockPassportIdentityController({
      prepareGoogleAuthorization: vi.fn(async (onState) => {
        emitState = onState;
        onState({ stage: "google-authorization", errorCode: null });
      }),
      continueGoogleBackedIdentityAction: continueAction,
    });
    render(<SignInFlow controller={controller} onComplete={vi.fn()} onSetupStarted={vi.fn()} />);
    await waitFor(() => expect(emitState).toBeDefined());
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

    act(() => emitState?.({ stage: "requesting-google-authorization" }));
    expect(await screen.findByRole("heading", { name: "Requesting Google access." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Setting up your pubky." })).not.toBeInTheDocument();

    act(() => emitState?.({ stage: "google-authorization", errorCode: "google_drive_authorization_popup_closed" }));
    expect(await screen.findByRole("heading", { name: "Google access denied." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(continueAction).toHaveBeenCalledTimes(2);
  });

  it("preserves restored mode through completion", async () => {
    const onComplete = vi.fn();
    const googleAccount = { id: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: null };
    const controller = mockPassportIdentityController({
      list: vi.fn(() => Result.ok({ activeIdentityId: "key", identities: [{ id: "key", publicIdentity: { publicKeyZ32: "key", publicKeyDisplay: "pubkykey" }, googleAccount }] })),
      prepareGoogleAuthorization: vi.fn(async (onState) => onState({ stage: "google-authorization", errorCode: null })),
      continueGoogleBackedIdentityAction: vi.fn(async () => ({
        status: "action_completed" as const,
        result: Result.ok({ kind: "google_backed_identity_established" as const, establishmentMode: "restored" as const, publicIdentity: { publicKeyZ32: "key", publicKeyDisplay: "pubkykey" } }),
      })),
    });
    render(<SignInFlow controller={controller} onComplete={onComplete} onSetupStarted={vi.fn()} />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Restore complete." })).toBeInTheDocument();
    expect(screen.getByText("Satoshi Nakamoto")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
