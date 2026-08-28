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
  afterEach(() => cleanup());

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
    expect(screen.getByText("active@gmail.com")).toHaveClass("normal-case");
    expect(screen.getByText("active@gmail.com")).not.toHaveClass("uppercase");
    expect(activeRow).not.toHaveTextContent("seco...5678");
    const otherRow = screen.getByRole("button", { name: /Other Account/ });
    expect(otherRow).toHaveTextContent("other@gmail.com");
    await userEvent.setup().click(otherRow);
    expect(onSelect).toHaveBeenCalledWith("firstidentity1234");
    const back = screen.getByRole("button", { name: "Back" });
    await userEvent.setup().click(back);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("falls back to the shortened Pubky when an identity has no email", () => {
    render(
      <IdentitySwitcher
        activePublicKeyZ32="localidentity1234"
        identities={[{ publicIdentity: { publicKeyZ32: "localidentity1234" } }]}
        onAddIdentity={vi.fn()}
        onBack={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Your Pubky/ })).toHaveTextContent("loca...1234");
  });
});
