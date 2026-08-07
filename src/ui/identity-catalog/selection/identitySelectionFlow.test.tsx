/** @vitest-environment jsdom */

import { Result } from "better-result";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mockPassportIdentityController } from "../../../../test-utils/fakes/mockPassportIdentityController";
import { IdentitySelectionFlow } from "./identitySelectionFlow";

vi.mock("../../onboarding/signInFlow", () => ({
  SignInFlow: ({ onBack, onComplete }: { onBack: () => void; onComplete: () => void }) => (
    <>
      <button onClick={onComplete} type="button">Complete identity setup</button>
      <button onClick={onBack} type="button">Cancel identity setup</button>
    </>
  ),
}));

const CATALOG = {
  activeIdentityId: "first",
  identities: [
    { id: "first", publicIdentity: { publicKeyDisplay: "pubkyfirst", publicKeyZ32: "first" } },
    { id: "second", publicIdentity: { publicKeyDisplay: "pubkysecond", publicKeyZ32: "second" } },
  ],
};

describe("IdentitySelectionFlow", () => {
  afterEach(cleanup);

  it("selects an existing identity and finishes", async () => {
    const onIdentitySelected = vi.fn();
    const controller = mockPassportIdentityController({ select: vi.fn(() => Result.ok()) });
    render(<IdentitySelectionFlow catalog={CATALOG} controller={controller} onBack={vi.fn()} onIdentitySelected={onIdentitySelected} />);

    await userEvent.setup().click(screen.getByRole("button", { name: /Your Pubky.*seco/iu }));
    expect(controller.select).toHaveBeenCalledWith("second");
    expect(onIdentitySelected).toHaveBeenCalledOnce();
  });

  it("runs the normal identity setup flow from Add identity", async () => {
    const onIdentitySelected = vi.fn();
    render(<IdentitySelectionFlow catalog={CATALOG} controller={mockPassportIdentityController()} onBack={vi.fn()} onIdentitySelected={onIdentitySelected} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Add identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Complete identity setup" }));
    expect(onIdentitySelected).toHaveBeenCalledOnce();
  });

  it("returns to identity selection when identity setup is cancelled", async () => {
    render(<IdentitySelectionFlow catalog={CATALOG} controller={mockPassportIdentityController()} onBack={vi.fn()} onIdentitySelected={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Add identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel identity setup" }));

    expect(screen.getByRole("heading", { name: "Switch identity." })).toBeInTheDocument();
  });
});
