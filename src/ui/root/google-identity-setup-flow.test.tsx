/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GoogleBackedIdentityActionState } from "../../browser/identity/passportIdentity";
import { mockPassportIdentityController } from "../../../test-utils/fakes/mockPassportIdentityController";
import { GoogleIdentitySetupFlow } from "./google-identity-setup-flow";

describe("GoogleIdentitySetupFlow", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("requires a user gesture when the browser no longer has transient activation", async () => {
    let emitState: ((state: GoogleBackedIdentityActionState) => void) | undefined;
    const continueAction = vi.fn(async () => ({ status: "busy" as const }));
    const controller = mockPassportIdentityController({
      mountGoogleSignIn: vi.fn(async (_target, onState) => { emitState = onState; }),
      continueGoogleBackedIdentityAction: continueAction,
    });

    render(<GoogleIdentitySetupFlow controller={controller} onComplete={vi.fn()} onSetupStarted={vi.fn()} />);
    await waitFor(() => expect(emitState).toBeDefined());
    act(() => emitState?.({ stage: "google-drive-authorization" }));

    expect(continueAction).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Authorize Google Drive" }));
    expect(continueAction).toHaveBeenCalledWith({ kind: "establish_google_backed_identity" });
  });

  it("continues automatically when the browser preserves transient activation", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "userActivation");
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: { hasBeenActive: true, isActive: true } });
    try {
      let emitState: ((state: GoogleBackedIdentityActionState) => void) | undefined;
      const continueAction = vi.fn(async () => ({ status: "busy" as const }));
      const controller = mockPassportIdentityController({
        mountGoogleSignIn: vi.fn(async (_target, onState) => { emitState = onState; }),
        continueGoogleBackedIdentityAction: continueAction,
      });
      render(<GoogleIdentitySetupFlow controller={controller} onComplete={vi.fn()} onSetupStarted={vi.fn()} />);
      await waitFor(() => expect(emitState).toBeDefined());

      act(() => emitState?.({ stage: "google-drive-authorization" }));

      expect(continueAction).toHaveBeenCalledWith({ kind: "establish_google_backed_identity" });
    } finally {
      if (descriptor) Object.defineProperty(navigator, "userActivation", descriptor);
      else Reflect.deleteProperty(navigator, "userActivation");
    }
  });

  it("shows the restore branch reported by the controller", async () => {
    let emitState: ((state: GoogleBackedIdentityActionState) => void) | undefined;
    const controller = mockPassportIdentityController({ mountGoogleSignIn: vi.fn(async (_target, onState) => { emitState = onState; }) });
    render(<GoogleIdentitySetupFlow controller={controller} onComplete={vi.fn()} onSetupStarted={vi.fn()} />);
    await waitFor(() => expect(emitState).toBeDefined());
    act(() => emitState?.({ stage: "establishing-google-backed-identity", progress: "restoring_identity" }));

    expect(await screen.findByText("Restore your Pubky")).toBeInTheDocument();
    expect(screen.getByText("Restore your Pubky").closest("li")).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Activate identity").closest("li")).toHaveAttribute("data-state", "pending");
  });
});
