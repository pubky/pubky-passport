/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IdentitySwitcher } from "./identitySwitcher";

const IDENTITIES = [
  {
    publicIdentity: { publicKeyZ32: "firstidentity1234" },
    googleAccount: {
      googleSubject: "google-1",
      email: "other@gmail.com",
      name: "Other Account",
      pictureUrl: null,
    },
  },
  {
    publicIdentity: { publicKeyZ32: "secondidentity5678" },
    googleAccount: {
      googleSubject: "google-2",
      email: "active@gmail.com",
      name: "Active Account",
      pictureUrl: null,
    },
  },
];

describe("IdentitySwitcher", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("marks the active identity and selects another identity", async () => {
    const onSelect = vi.fn();
    const onBack = vi.fn();
    render(
      <IdentitySwitcher
        activePublicKeyZ32="secondidentity5678"
        identities={IDENTITIES}
        onAddIdentity={vi.fn()}
        onBack={onBack}
        onSelect={onSelect}
      />,
    );

    const activeRow = screen.getByRole("button", { name: /Active Account/ });
    expect(activeRow).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getAllByRole("button").filter((button) => button.hasAttribute("aria-pressed"))[0],
    ).toBe(activeRow);
    expect(screen.getByText("active@gmail.com")).toHaveClass("lowercase");
    expect(activeRow).not.toHaveTextContent("seco...5678");
    const otherRow = screen.getByRole("button", { name: /Other Account/ });
    expect(otherRow).toHaveTextContent("other@gmail.com");
    expect(otherRow).not.toHaveTextContent("firs...1234");
    await userEvent.setup().click(otherRow);
    expect(onSelect).toHaveBeenCalledWith("firstidentity1234");
    const back = screen.getByRole("button", { name: "Back" });
    const addIdentity = screen.getByRole("button", { name: "Add identity" });
    // Add identity above Back, which sits at the bottom of the column, at every width.
    expect([addIdentity, back]).toEqual(
      screen
        .getAllByRole("button")
        .filter((button) => ["Back", "Add identity"].includes(button.textContent ?? "")),
    );
    expect(back).toHaveClass("mt-auto");
    expect(back.className).not.toMatch(/md:/u);
    await userEvent.setup().click(back);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows the shortened Pubky when an identity has no Google account", () => {
    render(
      <IdentitySwitcher
        activePublicKeyZ32="localidentity1234"
        identities={[{ publicIdentity: { publicKeyZ32: "localidentity1234" } }]}
        onAddIdentity={vi.fn()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const localKey = screen.getByText("loca...1234");
    expect(localKey).toHaveClass("lowercase");
    expect(screen.getByRole("button", { name: /Your Pubky/ })).toContainElement(localKey);
  });
});
