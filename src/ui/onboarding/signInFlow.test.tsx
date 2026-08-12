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

    render(<SignInFlow controller={controller} onComplete={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(continueAction).toHaveBeenCalledWith({ kind: "establish_google_backed_identity" });
    expect(screen.queryByRole("button", { name: "Continue with Apple" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Requesting Google access." })).toBeInTheDocument();
  });

  it("only shows contextual back navigation when supplied by its parent flow", async () => {
    const onBack = vi.fn();
    const controller = mockPassportIdentityController({
      prepareGoogleAuthorization: vi.fn(async (onState) => onState({ stage: "google-authorization", errorCode: null })),
    });

    const rendered = render(<SignInFlow controller={controller} onBack={onBack} onComplete={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();

    rendered.rerender(<SignInFlow controller={controller} onComplete={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
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
    render(<SignInFlow controller={controller} onComplete={vi.fn()} />);
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
    render(<SignInFlow controller={controller} onComplete={vi.fn()} />);
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
    render(<SignInFlow controller={controller} onComplete={vi.fn()} />);
    await waitFor(() => expect(emitState).toBeDefined());
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

    act(() => emitState?.({ stage: "requesting-google-authorization" }));
    expect(await screen.findByRole("heading", { name: "Requesting Google access." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Setting up your pubky." })).not.toBeInTheDocument();

    act(() => emitState?.({ stage: "google-authorization", errorCode: "google_authorization_failed" }));
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
      list: vi.fn(() => Result.ok({ activeIdentityId: "key", identities: [{ id: "key", publicIdentity: { publicKeyZ32: "key", publicKeyDisplay: "pubkykey" }, googleAccount }] })),
      prepareGoogleAuthorization: vi.fn(async (onState) => onState({ stage: "google-authorization", errorCode: null })),
      continueGoogleBackedIdentityAction: vi.fn(async () => ({
        status: "action_completed" as const,
        result: Result.ok({ kind: "google_backed_identity_established" as const, establishmentMode: "restored" as const, publicIdentity: { publicKeyZ32: "key", publicKeyDisplay: "pubkykey" } }),
      })),
    });
    render(<SignInFlow controller={controller} onComplete={onComplete} />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Restore complete." })).toBeInTheDocument();
    expect(screen.getByText("Satoshi Nakamoto")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("shows the real setup error and confirms replacement of an incomplete backup", async () => {
    const googleAccount = { id: "google-1", email: "user@gmail.com", name: "User", pictureUrl: null };
    const publicIdentity = { publicKeyZ32: "key", publicKeyDisplay: "pubkykey" };
    const continueAction = vi.fn()
      .mockResolvedValueOnce({
        status: "action_completed" as const,
        result: Result.err({
          code: "signin_failed" as const,
          preservedPassportFileIdentity: publicIdentity,
          recovery: { googleAccount, publicIdentity },
        }),
      })
      .mockResolvedValueOnce({ status: "busy" as const });
    const controller = mockPassportIdentityController({
      prepareGoogleAuthorization: vi.fn(async (onState) => onState({ stage: "google-authorization", errorCode: null })),
      continueGoogleBackedIdentityAction: continueAction,
    });
    render(<SignInFlow controller={controller} onComplete={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Setup interrupted." })).toBeInTheDocument();
    expect(screen.getByText("signin_failed")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Delete backup & create new Pubky" }));
    expect(screen.getByRole("heading", { name: "Delete backup and start over?" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Delete & create new" }));

    expect(continueAction).toHaveBeenNthCalledWith(2, {
      kind: "replace_incomplete_google_backed_identity",
      publicIdentity,
      expectedGoogleAccountId: googleAccount.id,
    });
  });
});
