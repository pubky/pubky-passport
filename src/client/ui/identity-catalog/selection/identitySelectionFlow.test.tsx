/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PassportCollaboratorsProvider } from "@/client/ui/passportCollaborators";
import { IdentitySelectionFlow } from "./identitySelectionFlow";

function IdentitySetupStub({
  forAuthorization,
  onBack,
  onComplete,
}: {
  forAuthorization?: boolean;
  onBack?: () => void;
  onComplete: () => void;
}) {
  return (
    <>
      {forAuthorization ? <p>Authorization identity setup</p> : null}
      <button onClick={onComplete} type="button">
        Complete identity setup
      </button>
      <button onClick={onBack} type="button">
        Cancel identity setup
      </button>
    </>
  );
}

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
      <PassportCollaboratorsProvider value={{ IdentitySetup: IdentitySetupStub }}>
        <IdentitySelectionFlow
          catalog={CATALOG}
          onBack={vi.fn()}
          onIdentitySelected={onIdentitySelected}
          selectIdentity={() => Result.ok()}
        />
      </PassportCollaboratorsProvider>,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Add identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Complete identity setup" }));
    expect(onIdentitySelected).toHaveBeenCalledOnce();
  });

  it("uses the authorization variant when adding an identity", async () => {
    render(
      <PassportCollaboratorsProvider value={{ IdentitySetup: IdentitySetupStub }}>
        <IdentitySelectionFlow
          catalog={CATALOG}
          forAuthorization
          onBack={vi.fn()}
          onIdentitySelected={vi.fn()}
          selectIdentity={() => Result.ok()}
        />
      </PassportCollaboratorsProvider>,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Use other identity" }));

    expect(screen.getByText("Authorization identity setup")).toBeInTheDocument();
  });

  it("returns to identity selection when identity setup is cancelled", async () => {
    render(
      <PassportCollaboratorsProvider value={{ IdentitySetup: IdentitySetupStub }}>
        <IdentitySelectionFlow
          catalog={CATALOG}
          onBack={vi.fn()}
          onIdentitySelected={vi.fn()}
          selectIdentity={() => Result.ok()}
        />
      </PassportCollaboratorsProvider>,
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
