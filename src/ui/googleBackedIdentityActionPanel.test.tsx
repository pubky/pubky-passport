/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import type { GoogleBackedIdentityActionState, PassportIdentityController } from "../browser/identity/passportIdentity";
import { mockPassportIdentityController } from "../../test-utils/fakes/mockPassportIdentityController";
import { GoogleBackedIdentityActionPanel } from "./googleBackedIdentityActionPanel";

describe("GoogleBackedIdentityActionPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders controller state and continues without receiving credentials", async () => {
    let emitState: ((state: GoogleBackedIdentityActionState) => void) | undefined;
    const continueGoogleBackedIdentityAction = vi.fn(async () => ({
      status: "action_completed" as const,
      result: Result.ok({ kind: "google_drive_passport_file_deleted" as const, deletionStatus: "deleted" as const }),
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
    emitState?.({ stage: "google-drive-authorization" });
    const driveButton = await screen.findByRole("button", { name: "Authorize Google Drive" });
    await waitFor(() => expect(driveButton).toHaveFocus());
    expect(driveButton.closest("[aria-busy]")).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("status")).toHaveTextContent("Authorize Google Drive to delete the Passport file.");
    await userEvent.setup().click(driveButton);

    expect(continueGoogleBackedIdentityAction).toHaveBeenCalledWith({
      kind: "delete_google_drive_passport_file",
      expectedPublicKeyZ32: "public-key",
    });
    expect(onActionCompleted).toHaveBeenCalledWith(Result.ok({
      kind: "google_drive_passport_file_deleted",
      deletionStatus: "deleted",
    }));

    emitState?.({ stage: "requesting-google-drive-authorization" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Waiting for Google Drive authorization to delete the Passport file."));
    expect(busyRegion()).toHaveAttribute("aria-busy", "true");

    emitState?.({ stage: "deleting-google-drive-passport-file" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Deleting the Google Drive Passport file."));
    expect(busyRegion()).toHaveAttribute("aria-busy", "true");
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

  it("renders creation progress from authoritative controller phases", async () => {
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
    emitState?.({ stage: "requesting-google-drive-authorization" });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Waiting for Google Drive authorization to create or restore your Pubky identity.");
      expect(onBusyChange).toHaveBeenLastCalledWith(true);
    });

    emitState?.({ stage: "establishing-google-backed-identity", progress: "checking_passport_file" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Checking for your encrypted Passport backup."));
    expect(screen.getByText("Check encrypted Passport backup").closest("li")).toHaveAttribute("data-state", "active");

    emitState?.({ stage: "establishing-google-backed-identity", progress: "preparing_new_identity" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Preparing new identity setup."));
    expect(screen.getAllByRole("listitem").map((step) => step.getAttribute("data-state"))).toEqual([
      "complete",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);

    emitState?.({ stage: "establishing-google-backed-identity", progress: "signing_up_to_homeserver" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Signing up to your homeserver."));
    const creationSteps = screen.getAllByRole("listitem");
    expect(creationSteps.map((step) => step.getAttribute("data-state"))).toEqual([
      "complete",
      "complete",
      "active",
      "pending",
      "pending",
    ]);
    expect(busyRegion()).toHaveAttribute("aria-busy", "true");
  });

  it("renders restore-specific progress without creation steps", async () => {
    let emitState: ((state: GoogleBackedIdentityActionState) => void) | undefined;
    const controller = fakeController({
      mountGoogleSignIn: vi.fn(async (_target, onState) => { emitState = onState; }),
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

    await waitFor(() => expect(emitState).toBeDefined());
    emitState?.({ stage: "establishing-google-backed-identity", progress: "activating_restored_identity" });

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Activating your restored Pubky identity."));
    expect(screen.getAllByRole("listitem").map((step) => step.getAttribute("data-state"))).toEqual([
      "complete",
      "complete",
      "active",
    ]);
    expect(screen.queryByText("Sign up to homeserver")).not.toBeInTheDocument();
  });

  it.each([
    ["preparing_secure_identity", "Preparing secure identity access.", "Prepare secure identity access"],
    ["checking_passport_file", "Checking for your encrypted Passport backup.", "Check encrypted Passport backup"],
    ["preparing_new_identity", "Preparing new identity setup.", null],
    ["creating_identity", "Creating your Pubky identity.", "Create and store encrypted identity"],
    ["storing_encrypted_identity", "Storing your encrypted Passport backup.", "Create and store encrypted identity"],
    ["signing_up_to_homeserver", "Signing up to your homeserver.", "Sign up to homeserver"],
    ["publishing_discovery", "Publishing discovery records.", "Publish discovery records"],
    ["activating_created_identity", "Activating your Pubky identity.", "Activate identity"],
    ["restoring_identity", "Restoring your Pubky identity.", "Restore Pubky identity"],
    ["activating_restored_identity", "Activating your restored Pubky identity.", "Activate identity"],
  ] as const)("projects %s into truthful status and checklist state", async (progress, status, activeLabel) => {
    let emitState: ((state: GoogleBackedIdentityActionState) => void) | undefined;
    render(
      <GoogleBackedIdentityActionPanel
        action={{ kind: "establish_google_backed_identity" }}
        controller={fakeController({
          mountGoogleSignIn: vi.fn(async (_target, onState) => { emitState = onState; }),
        })}
        disabled={false}
        onActionCompleted={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(emitState).toBeDefined());

    emitState?.({ stage: "establishing-google-backed-identity", progress });

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(status));
    const activeStep = screen.getAllByRole("listitem").find((step) => step.getAttribute("data-state") === "active");
    if (activeLabel) expect(activeStep).toHaveTextContent(activeLabel);
    else expect(activeStep).toBeUndefined();
  });

  it("renders a safe failure when an action rejects", async () => {
    let emitState: ((state: GoogleBackedIdentityActionState) => void) | undefined;
    const controller = fakeController({
      mountGoogleSignIn: vi.fn(async (_target, onState) => { emitState = onState; }),
      continueGoogleBackedIdentityAction: vi.fn(async () => {
        throw new Error("SECRET-ACTION-CREDENTIAL");
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

    await waitFor(() => expect(emitState).toBeDefined());
    emitState?.({ stage: "google-drive-authorization" });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Authorize Google Drive" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Passport could not continue the Google identity action. Try again.");
  });

  it("contains sign-in cleanup failures", () => {
    const controller = fakeController({
      unmountGoogleSignIn: vi.fn(() => { throw new Error("SECRET-CLEANUP-DETAIL"); }),
    });
    const rendered = render(
      <GoogleBackedIdentityActionPanel
        action={{ kind: "establish_google_backed_identity" }}
        controller={controller}
        disabled={false}
        onActionCompleted={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    expect(() => rendered.unmount()).not.toThrow();
  });
});

function fakeController(overrides: Partial<PassportIdentityController>): PassportIdentityController {
  return mockPassportIdentityController(overrides);
}

function busyRegion(): Element | null {
  return screen.getByRole("status").parentElement?.querySelector("[aria-busy]") ?? null;
}
