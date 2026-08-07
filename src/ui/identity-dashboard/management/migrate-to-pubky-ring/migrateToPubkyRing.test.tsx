/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MigrateToPubkyRing } from "./migrateToPubkyRing";

const MIGRATION_URL = "pubkyring://migrate?index=0&total=1&key=0123456789abcdef";

describe("MigrateToPubkyRing", () => {
  afterEach(cleanup);

  it("offers the verified stores and direct import for the active identity", () => {
    render(<MigrateToPubkyRing migrationUrl={MIGRATION_URL} onBack={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Download Pubky Ring on the App Store" }))
      .toHaveAttribute("href", "https://apps.apple.com/us/app/pubky-ring/id6739356756");
    expect(screen.getByRole("link", { name: "Get Pubky Ring on Google Play" }))
      .toHaveAttribute("href", "https://play.google.com/store/apps/details?id=to.pubky.ring&hl=en-US");
    expect(screen.getByRole("link", { name: "Import pubky" })).toHaveAttribute("href", MIGRATION_URL);
    expect(document.querySelector('[data-slot="pubky-ring-keychain-illustration"]'))
      .toHaveAttribute("src", "/illustrations/pubky-ring-keychain.png");
  });

  it("reveals the Ring-compatible QR without exporting another identity", async () => {
    render(<MigrateToPubkyRing migrationUrl={MIGRATION_URL} onBack={vi.fn()} />);

    const showQr = screen.getByRole("button", { name: "Show QR" });
    expect(showQr).toHaveAttribute("data-variant", "secondary");
    await userEvent.setup().click(showQr);

    const dialog = screen.getByRole("dialog", { name: "Scan with Pubky Ring" });
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByRole("img", { name: "Pubky Ring migration QR code" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    expect(dialog).not.toHaveAttribute("open");
  });
});
