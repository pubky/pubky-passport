/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentitySummary } from "../../../browser/identity/passportIdentity";
import { IdentityManagement } from "./identityManagement";

const identity = {
  googleAccount: { email: "satoshi@gmail.com", name: "Satoshi Nakamoto" },
  publicIdentity: { publicKeyZ32: "x8jpihgjy51fdnaingcp8rum1omfzd6p8bhm7usune41grd97dho5cwy4mra" },
} as LocalIdentitySummary;

describe("IdentityManagement", () => {
  afterEach(cleanup);

  it("copies the Pubky and resolved PKDNS homeserver with Figma ghost buttons", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const onBack = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<IdentityManagement identity={identity} onBack={onBack} onDownloadBackup={vi.fn()} onLogOut={vi.fn()} resolveHomeserver={async () => Result.ok("homeserver-pubky")} />);
    const back = screen.getByRole("button", { name: "Back" });
    expect(back).toHaveClass("h-[60px]", "w-full");
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledOnce();
    const copyButton = screen.getByRole("button", { name: "Copy Pubky" });
    fireEvent.click(copyButton);

    expect(copyButton).toHaveAttribute("data-variant", "ghost");
    expect(writeText).toHaveBeenCalledWith(identity.publicIdentity.publicKeyZ32);
    const homeserverButton = screen.getByRole("button", { name: "Copy Homeserver" });
    await waitFor(() => expect(homeserverButton).toBeEnabled());
    fireEvent.click(homeserverButton);
    expect(writeText).toHaveBeenCalledWith("homeserver-pubky");
  });
});
