/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentitySummary } from "../../browser/identity/passportIdentity";
import { IdentityManagement } from "./identity-management";

const identity = {
  googleAccount: { email: "satoshi@gmail.com", name: "Satoshi Nakamoto" },
  publicIdentity: { publicKeyZ32: "x8jpihgjy51fdnaingcp8rum1omfzd6p8bhm7usune41grd97dho5cwy4mra" },
} as LocalIdentitySummary;

describe("IdentityManagement", () => {
  afterEach(cleanup);

  it("copies the Pubky with the Figma ghost copy button", () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<IdentityManagement identity={identity} onLogOut={vi.fn()} />);
    const copyButton = screen.getByRole("button", { name: "Copy Pubky" });
    fireEvent.click(copyButton);

    expect(copyButton).toHaveAttribute("data-variant", "ghost");
    expect(writeText).toHaveBeenCalledWith(identity.publicIdentity.publicKeyZ32);
    expect(screen.getByRole("button", { name: "Copy Homeserver" })).toBeDisabled();
  });
});
