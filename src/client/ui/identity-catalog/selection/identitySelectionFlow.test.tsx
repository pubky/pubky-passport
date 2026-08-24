/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IdentitySelectionFlow } from "./identitySelectionFlow";

vi.mock("../../onboarding/identityEstablishmentFlow", () => ({
  IdentityEstablishmentFlow: ({ onBack, onComplete }: { onBack: () => void; onComplete: () => void }) => (
    <>
      <button onClick={onComplete} type="button">Complete identity setup</button>
      <button onClick={onBack} type="button">Cancel identity setup</button>
    </>
  ),
}));

const CATALOG = {
  activePublicKeyZ32: "first",
  identities: [
    { publicIdentity: { publicKeyDisplay: "pubkyfirst", publicKeyZ32: "first" } },
    { publicIdentity: { publicKeyDisplay: "pubkysecond", publicKeyZ32: "second" } },
  ],
};
describe("IdentitySelectionFlow", () => {
  afterEach(cleanup);

  it("selects an existing identity and finishes", async () => {
    const onIdentitySelected = vi.fn();
    const selectIdentity = vi.fn(() => true);
    render(<IdentitySelectionFlow catalog={CATALOG} onBack={vi.fn()} onIdentitySelected={onIdentitySelected} selectIdentity={selectIdentity} />);

    await userEvent.setup().click(screen.getByRole("button", { name: /Your Pubky.*seco/iu }));
    expect(selectIdentity).toHaveBeenCalledWith("second");
    expect(onIdentitySelected).toHaveBeenCalledOnce();
  });

  it("runs the normal identity setup flow from Add identity", async () => {
    const onIdentitySelected = vi.fn();
    render(<IdentitySelectionFlow catalog={CATALOG} onBack={vi.fn()} onIdentitySelected={onIdentitySelected} selectIdentity={() => true} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Add identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Complete identity setup" }));
    expect(onIdentitySelected).toHaveBeenCalledOnce();
  });

  it("returns to identity selection when identity setup is cancelled", async () => {
    render(<IdentitySelectionFlow catalog={CATALOG} onBack={vi.fn()} onIdentitySelected={vi.fn()} selectIdentity={() => true} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Add identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel identity setup" }));

    expect(screen.getByRole("heading", { name: "Switch identity." })).toBeInTheDocument();
  });
});
