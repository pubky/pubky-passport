/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IdentitySelectionFlow } from "./identitySelectionFlow";

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
        onAddIdentity={vi.fn()}
        onBack={vi.fn()}
        onIdentitySelected={onIdentitySelected}
        selectIdentity={selectIdentity}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: /Pubky second/u }));
    expect(selectIdentity).toHaveBeenCalledWith("second");
    expect(onIdentitySelected).toHaveBeenCalledOnce();
  });

  it("delegates Add identity to the shared root navigation", async () => {
    const onAddIdentity = vi.fn();
    render(
      <IdentitySelectionFlow
        catalog={CATALOG}
        onAddIdentity={onAddIdentity}
        onBack={vi.fn()}
        onIdentitySelected={vi.fn()}
        selectIdentity={() => Result.ok()}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Add identity" }));
    expect(onAddIdentity).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Continue with Pubky Ring" }),
    ).not.toBeInTheDocument();
  });

  it("reports once that every identity is on screen", () => {
    const onShow = vi.fn();
    const { rerender } = render(
      <IdentitySelectionFlow
        catalog={CATALOG}
        onAddIdentity={vi.fn()}
        onBack={vi.fn()}
        onIdentitySelected={vi.fn()}
        onShow={onShow}
        selectIdentity={() => Result.ok()}
      />,
    );
    rerender(
      <IdentitySelectionFlow
        catalog={CATALOG}
        onAddIdentity={vi.fn()}
        onBack={vi.fn()}
        onIdentitySelected={vi.fn()}
        onShow={onShow}
        selectIdentity={() => Result.ok()}
      />,
    );
    expect(onShow).toHaveBeenCalledOnce();
  });

  it("keeps the switcher open and explains selection failures", async () => {
    const onIdentitySelected = vi.fn();
    render(
      <IdentitySelectionFlow
        catalog={CATALOG}
        onAddIdentity={vi.fn()}
        onBack={vi.fn()}
        onIdentitySelected={onIdentitySelected}
        selectIdentity={() => Result.err({ code: "storage_unavailable" })}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: /Pubky second/u }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't switch. Your browser didn't let Passport save your choice. Try again.",
    );
    expect(onIdentitySelected).not.toHaveBeenCalled();
  });
});
