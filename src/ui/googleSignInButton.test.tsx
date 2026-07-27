/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Result } from "better-result";

import type { BrowserIdentityController, GoogleSignInState } from "../browser/identity/browserIdentityController";
import { GoogleSignInButton } from "./googleSignInButton";

describe("GoogleSignInButton", () => {
  afterEach(cleanup);

  it("renders controller state and continues without receiving credentials", async () => {
    let emitState: ((state: GoogleSignInState) => void) | undefined;
    const continueGoogle = vi.fn(async () => ({
      status: "action_completed" as const,
      result: Result.ok({ kind: "deleted" as const }),
    }));
    const onActionCompleted = vi.fn();
    const controller = fakeController({
      mountGoogleSignIn: vi.fn(async (_target, onState) => { emitState = onState; }),
      continueGoogle,
    });
    render(
      <GoogleSignInButton
        action={{ kind: "delete", expectedPublicKeyZ32: "public-key" }}
        controller={controller}
        disabled={false}
        onActionCompleted={onActionCompleted}
        onBusyChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(emitState).toBeDefined());
    emitState?.({ stage: "drive", errorCode: null });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Allow Drive access" }));

    expect(continueGoogle).toHaveBeenCalledWith({ kind: "delete", expectedPublicKeyZ32: "public-key" });
    expect(onActionCompleted).toHaveBeenCalledWith(Result.ok({ kind: "deleted" }));
  });

  it("shows safe controller errors and delegates retry", async () => {
    const retryGoogleSignIn = vi.fn();
    const controller = fakeController({
      mountGoogleSignIn: vi.fn(async (_target, onState) => {
        onState({ stage: "sign-in", errorCode: "sign_in_unavailable" });
      }),
      retryGoogleSignIn,
    });
    render(
      <GoogleSignInButton
        action={{ kind: "establish" }}
        controller={controller}
        disabled={false}
        onActionCompleted={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toBe("Google sign-in is unavailable. Try again.");
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(retryGoogleSignIn).toHaveBeenCalledOnce();
  });
});

function fakeController(overrides: Partial<BrowserIdentityController>): BrowserIdentityController {
  return {
    list: vi.fn(() => Result.ok({ activeIdentityId: null, identities: [] })),
    select: vi.fn(() => Result.ok()),
    clear: vi.fn(() => Result.ok()),
    subscribe: vi.fn(() => () => {}),
    mountGoogleSignIn: vi.fn(async () => {}),
    unmountGoogleSignIn: vi.fn(),
    retryGoogleSignIn: vi.fn(),
    continueGoogle: vi.fn(async () => ({ status: "credential_failed" as const })),
    dispose: vi.fn(),
    ...overrides,
  };
}
