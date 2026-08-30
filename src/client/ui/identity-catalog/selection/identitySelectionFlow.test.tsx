/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IdentitySelectionFlow } from "./identitySelectionFlow";

vi.mock("../../onboarding/identityEstablishmentFlow", () => ({
  IdentityEstablishmentFlow: ({
    onBack,
    onComplete,
    signInTo,
  }: {
    onBack: () => void;
    onComplete: () => void;
    signInTo?: string;
  }) => (
    <>
      {signInTo ? <p>Signing in to {signInTo}</p> : null}
      <button onClick={onComplete} type="button">
        Complete identity setup
      </button>
      <button onClick={onBack} type="button">
        Cancel identity setup
      </button>
    </>
  ),
}));

const CATALOG = {
  activePublicKeyZ32: "first",
  identities: [
    { publicIdentity: { publicKeyZ32: "first" } },
    { publicIdentity: { publicKeyZ32: "second" } },
  ],
};
describe("IdentitySelectionFlow", () => {
  afterEach(cleanup);

  it("selects an existing identity and finishes", async () => {
    const onIdentitySelected = vi.fn();
    const selectIdentity = vi.fn(() => Result.ok());
    render(
      <IdentitySelectionFlow
        catalog={CATALOG}
        onBack={vi.fn()}
        onIdentitySelected={onIdentitySelected}
        selectIdentity={selectIdentity}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: /Your Pubky.*seco/iu }));
    expect(selectIdentity).toHaveBeenCalledWith("second");
    expect(onIdentitySelected).toHaveBeenCalledOnce();
  });

  it("runs the normal identity setup flow from Add identity", async () => {
    const onIdentitySelected = vi.fn();
    render(
      <IdentitySelectionFlow
        catalog={CATALOG}
        onBack={vi.fn()}
        onIdentitySelected={onIdentitySelected}
        selectIdentity={() => Result.ok()}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Add identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Complete identity setup" }));
    expect(onIdentitySelected).toHaveBeenCalledOnce();
  });

  it("keeps authorization context when adding an identity", async () => {
    render(
      <IdentitySelectionFlow
        catalog={CATALOG}
        onBack={vi.fn()}
        onIdentitySelected={vi.fn()}
        selectIdentity={() => Result.ok()}
        signInTo="requesting.app"
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Use other identity" }));

    expect(screen.getByText("Signing in to requesting.app")).toBeInTheDocument();
  });

  it("returns to identity selection when identity setup is cancelled", async () => {
    render(
      <IdentitySelectionFlow
        catalog={CATALOG}
        onBack={vi.fn()}
        onIdentitySelected={vi.fn()}
        selectIdentity={() => Result.ok()}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Add identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel identity setup" }));

    expect(screen.getByRole("heading", { name: "Switch identity." })).toBeInTheDocument();
  });

  it("keeps the switcher open and explains selection failures", async () => {
    const onIdentitySelected = vi.fn();
    render(
      <IdentitySelectionFlow
        catalog={CATALOG}
        onBack={vi.fn()}
        onIdentitySelected={onIdentitySelected}
        selectIdentity={() => Result.err({ code: "storage_unavailable" })}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: /Your Pubky.*seco/iu }));

    expect(screen.getByText("Could not switch identities. Please try again.")).toBeInTheDocument();
    expect(onIdentitySelected).not.toHaveBeenCalled();
  });
});
