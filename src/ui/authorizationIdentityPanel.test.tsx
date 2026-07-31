/** @vitest-environment jsdom */

import { Result } from "better-result";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PassportIdentityController } from "../browser/identity/passportIdentity";
import { mockPassportIdentityController } from "../../test-utils/fakes/mockPassportIdentityController";
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
    await user.selectOptions(screen.getByRole("combobox", { name: "Authorization Pubky identity" }), "identity-2");

    expect(controller.select).toHaveBeenCalledWith("identity-2");
    expect(onReadyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText("Pubky identity ready.")).toBeInTheDocument();
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

    expect(screen.getByText("Sign in with Google to create or restore your Pubky identity.")).toBeInTheDocument();
    expect(controller.mountGoogleSignIn).toHaveBeenCalledOnce();
  });

  it("refreshes readiness when local identities change in another tab", async () => {
    let activeIdentityId: string | null = "identity-1";
    let refresh = () => {};
    const onReadyChange = vi.fn();
    const controller = mockPassportIdentityController({
      list: vi.fn(() => Result.ok({
        activeIdentityId,
        identities: activeIdentityId === null ? [] : [{
          id: "identity-1",
          publicIdentity: { publicKeyZ32: "identity-1", publicKeyDisplay: "pubkyidentity-1" },
        }],
      })),
      subscribe: vi.fn((listener) => {
        refresh = listener;
        return () => {};
      }),
    });

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

    activeIdentityId = null;
    act(() => refresh());

    await waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByRole("option", { name: "No local Pubky identity" })).toBeInTheDocument();
  });
});

function fakeIdentityController(input: { empty?: boolean } = {}): PassportIdentityController {
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
  return mockPassportIdentityController({
    list: vi.fn(() => Result.ok({
      activeIdentityId: input.empty ? null : "identity-1",
      identities,
    })),
    select: vi.fn(() => Result.ok()),
    clear: vi.fn(() => Result.ok()),
    subscribe: vi.fn(() => () => {}),
    mountGoogleSignIn: vi.fn(async (_target, onState) => onState({ stage: "google-sign-in", errorCode: null })),
    continueGoogleBackedIdentityAction: vi.fn(async () => ({ status: "busy" as const })),
  });
}
