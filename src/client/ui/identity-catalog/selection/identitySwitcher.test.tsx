/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IdentitySwitcher } from "./identitySwitcher";

const IDENTITIES = [
  { publicIdentity: { publicKeyZ32: "firstidentity1234", publicKeyDisplay: "pubkyfirst" }, googleAccount: { googleSubject: "google-1", email: "other@gmail.com", name: "Other Account", pictureUrl: null } },
  { publicIdentity: { publicKeyZ32: "secondidentity5678", publicKeyDisplay: "pubkysecond" }, googleAccount: { googleSubject: "google-2", email: "active@gmail.com", name: "Active Account", pictureUrl: null } },
];

describe("IdentitySwitcher", () => {
  afterEach(() => cleanup());

  it("marks the active identity and selects another identity", async () => {
    const onSelect = vi.fn();
    const onBack = vi.fn();
    render(<IdentitySwitcher activePublicKeyZ32="secondidentity5678" identities={IDENTITIES} onAddIdentity={vi.fn()} onBack={onBack} onSelect={onSelect} />);

    const activeRow = screen.getByRole("button", { name: /Active Account/ });
    expect(activeRow).toHaveAttribute("aria-pressed", "true");
    const otherRow = screen.getByRole("button", { name: /Other Account/ });
    await userEvent.setup().click(otherRow);
    expect(onSelect).toHaveBeenCalledWith("firstidentity1234");
    const back = screen.getByRole("button", { name: "Back" });
    await userEvent.setup().click(back);
    expect(onBack).toHaveBeenCalledOnce();
  });
});
