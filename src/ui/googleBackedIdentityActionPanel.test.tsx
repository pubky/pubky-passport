/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import type { BrowserIdentityController, GoogleBackedIdentityActionState } from "../browser/identity/browserIdentityController";
import { mockBrowserIdentityController } from "../../test-utils/fakes/mockBrowserIdentityController";
import { GoogleBackedIdentityActionPanel } from "./googleBackedIdentityActionPanel";

describe("GoogleBackedIdentityActionPanel", () => {
  afterEach(cleanup);

  it("renders controller state and continues without receiving credentials", async () => {
    let emitState: ((state: GoogleBackedIdentityActionState) => void) | undefined;
    const continueGoogleBackedIdentityAction = vi.fn(async () => ({
      status: "action_completed" as const,
      result: Result.ok({ kind: "google_drive_passport_file_deleted" as const }),
    }));
    const onActionCompleted = vi.fn();
    const controller = fakeController({
      mountGoogleSignIn: vi.fn(async (_target, onState) => { emitState = onState; }),
      continueGoogleBackedIdentityAction,
    });
    render(
      <GoogleBackedIdentityActionPanel
        action={{ kind: "delete_google_drive_passport_file", expectedPublicKeyZ32: "public-key" }}
        controller={controller}
        disabled={false}
        onActionCompleted={onActionCompleted}
        onBusyChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(emitState).toBeDefined());
    emitState?.({ stage: "google-drive-authorization", errorCode: null });
    const driveButton = await screen.findByRole("button", { name: "Authorize Google Drive" });
    await waitFor(() => expect(driveButton).toHaveFocus());
    expect(driveButton.closest("[aria-busy]")).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("status")).toHaveTextContent("Authorize Google Drive to delete the Passport file.");
    await userEvent.setup().click(driveButton);

    expect(continueGoogleBackedIdentityAction).toHaveBeenCalledWith({
      kind: "delete_google_drive_passport_file",
      expectedPublicKeyZ32: "public-key",
    });
    expect(onActionCompleted).toHaveBeenCalledWith(Result.ok({ kind: "google_drive_passport_file_deleted" }));

    emitState?.({ stage: "requesting-google-drive-authorization", errorCode: null });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Waiting for Google Drive authorization to delete the Passport file."));
    expect(screen.getByRole("status").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");

    emitState?.({ stage: "executing-action", errorCode: null });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Deleting the Google Drive Passport file."));
    expect(screen.getByRole("status").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
  });

  it("shows safe controller errors and focuses a rendered Google control after retry", async () => {
    let emitState: ((state: GoogleBackedIdentityActionState) => void) | undefined;
    const retryGoogleSignIn = vi.fn();
    const controller = fakeController({
      mountGoogleSignIn: vi.fn(async (_target, onState) => {
        emitState = onState;
        onState({ stage: "google-sign-in", errorCode: "sign_in_unavailable" });
      }),
      retryGoogleSignIn,
    });
    render(
      <GoogleBackedIdentityActionPanel
        action={{ kind: "establish_google_backed_identity" }}
        controller={controller}
        disabled={false}
        onActionCompleted={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toBe("Google sign-in is unavailable. Try again.");
    const retryButton = screen.getByRole("button", { name: "Try again" });
    await waitFor(() => expect(retryButton).toHaveFocus());
    await userEvent.setup().click(retryButton);
    expect(retryGoogleSignIn).toHaveBeenCalledOnce();

    const googleControl = document.createElement("button");
    screen.getByLabelText("Google sign-in").append(googleControl);
    emitState?.({ stage: "google-sign-in", errorCode: null });
    await waitFor(() => expect(googleControl).toHaveFocus());
  });

  it("focuses the labeled sign-in container after retry when Google renders no control", async () => {
    let emitState: ((state: GoogleBackedIdentityActionState) => void) | undefined;
    const controller = fakeController({
      mountGoogleSignIn: vi.fn(async (_target, onState) => {
        emitState = onState;
        onState({ stage: "google-sign-in", errorCode: "sign_in_failed" });
      }),
    });
    render(
      <GoogleBackedIdentityActionPanel
        action={{ kind: "establish_google_backed_identity" }}
        controller={controller}
        disabled={false}
        onActionCompleted={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    await userEvent.setup().click(await screen.findByRole("button", { name: "Try again" }));
    emitState?.({ stage: "google-sign-in", errorCode: null });

    await waitFor(() => expect(screen.getByLabelText("Google sign-in")).toHaveFocus());
  });

  it("announces identity execution separately from Drive authorization", async () => {
    let emitState: ((state: GoogleBackedIdentityActionState) => void) | undefined;
    const onBusyChange = vi.fn();
    const controller = fakeController({
      mountGoogleSignIn: vi.fn(async (_target, onState) => { emitState = onState; }),
    });
    render(
      <GoogleBackedIdentityActionPanel
        action={{ kind: "establish_google_backed_identity" }}
        controller={controller}
        disabled={false}
        onActionCompleted={vi.fn()}
        onBusyChange={onBusyChange}
      />,
    );

    await waitFor(() => expect(emitState).toBeDefined());
    emitState?.({ stage: "requesting-google-drive-authorization", errorCode: null });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Waiting for Google Drive authorization to create or restore your Pubky identity."));
    expect(onBusyChange).toHaveBeenLastCalledWith(true);

    emitState?.({ stage: "executing-action", errorCode: null });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Creating or restoring your Pubky identity."));
    expect(screen.getByRole("status").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
  });
});

function fakeController(overrides: Partial<BrowserIdentityController>): BrowserIdentityController {
  return mockBrowserIdentityController(overrides);
}
