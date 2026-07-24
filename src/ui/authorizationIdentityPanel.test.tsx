/** @vitest-environment jsdom */

import { Result } from "better-result";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrowserIdentityController } from "../browser/identity/browserIdentityController";
import { AuthorizationIdentityPanel } from "./authorizationIdentityPanel";

describe("AuthorizationIdentityPanel", () => {
  afterEach(cleanup);

  it("reports the active identity and allows switching without leaving authorization", async () => {
    const user = userEvent.setup();
    const onReadyChange = vi.fn();
    const controller = fakeIdentityController();

    render(
      <AuthorizationIdentityPanel
        controllerFactory={() => controller}
        disabled={false}
        googleClientId="google-client"
        homegateBaseUrl="https://homegate.example/"
        onReadyChange={onReadyChange}
      />,
    );

    await waitFor(() => expect(onReadyChange).toHaveBeenCalledWith(true));
    await user.selectOptions(screen.getByRole("combobox", { name: "Authorization identity" }), "identity-2");

    expect(controller.select).toHaveBeenCalledWith("identity-2");
    expect(onReadyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("Identity ready.")).toBeTruthy();
  });

  it("blocks readiness and offers Google establishment when no identity exists", async () => {
    const user = userEvent.setup();
    const onReadyChange = vi.fn();
    const controller = fakeIdentityController({ empty: true });

    render(
      <AuthorizationIdentityPanel
        controllerFactory={() => controller}
        disabled={false}
        googleClientId="google-client"
        homegateBaseUrl="https://homegate.example/"
        onReadyChange={onReadyChange}
      />,
    );

    await waitFor(() => expect(onReadyChange).toHaveBeenCalledWith(false));
    await user.click(screen.getByRole("button", { name: "Add or restore with Google" }));

    expect(screen.getByText("Sign in with Google to create or restore your Pubky identity.")).toBeTruthy();
    expect(controller.mountGoogleSignIn).toHaveBeenCalledOnce();
  });
});

function fakeIdentityController(input: { empty?: boolean } = {}): BrowserIdentityController {
  const identities = input.empty ? [] : [
    {
      id: "identity-1",
      publicIdentity: { publicKeyZ32: "identity-1", publicKeyDisplay: "pubkyidentity-1" },
    },
    {
      id: "identity-2",
      publicIdentity: { publicKeyZ32: "identity-2", publicKeyDisplay: "pubkyidentity-2" },
    },
  ];
  return {
    list: vi.fn(() => Result.ok({
      activeIdentityId: input.empty ? null : "identity-1",
      identities,
    })),
    select: vi.fn(() => Result.ok()),
    clear: vi.fn(() => Result.ok()),
    mountGoogleSignIn: vi.fn(async (_target, onState) => onState({ stage: "sign-in", errorCode: null })),
    unmountGoogleSignIn: vi.fn(),
    retryGoogleSignIn: vi.fn(),
    continueGoogle: vi.fn(async () => ({ status: "busy" as const })),
    dispose: vi.fn(),
  };
}
