/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MigrateToPubkyRing } from "./migrateToPubkyRing";

const MIGRATION_URL = "pubkyring://migrate?index=0&total=1&key=0123456789abcdef";

describe("MigrateToPubkyRing", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("offers the verified stores without exporting the identity on entry", () => {
    const createMigrationUrl = vi.fn(() => MIGRATION_URL);
    render(<MigrateToPubkyRing createMigrationUrl={createMigrationUrl} onBack={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Download Pubky Ring on the App Store" }))
      .toHaveAttribute("href", "https://apps.apple.com/us/app/pubky-ring/id6739356756");
    expect(screen.getByRole("link", { name: "Get Pubky Ring on Google Play" }))
      .toHaveAttribute("href", "https://play.google.com/store/apps/details?id=to.pubky.ring&hl=en-US");
    expect(screen.getByRole("button", { name: "Import pubky" })).not.toHaveAttribute("href");
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
    expect(createMigrationUrl).not.toHaveBeenCalled();
  });

  it("generates the URL on confirmation and unmounts the QR on close", async () => {
    const createMigrationUrl = vi.fn(() => MIGRATION_URL);
    render(<MigrateToPubkyRing createMigrationUrl={createMigrationUrl} onBack={vi.fn()} />);

    const showQr = screen.getByRole("button", { name: "Show QR" });
    await userEvent.setup().click(showQr);

    expect(createMigrationUrl).toHaveBeenCalledOnce();
    const dialog = screen.getByRole("dialog", { name: "Scan with Pubky Ring" });
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByRole("img", { name: "Pubky Ring migration QR code" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
  });

  it("clears the QR URL when continuing", () => {
    const onBack = vi.fn();
    render(<MigrateToPubkyRing createMigrationUrl={() => MIGRATION_URL} onBack={onBack} />);

    fireEvent.click(screen.getByRole("button", { name: "Show QR" }));
    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(continueButton).toHaveAttribute("data-variant", "default");
    expect(continueButton.querySelector("svg")).toBeInTheDocument();
    fireEvent.click(continueButton);

    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
  });

  it("hands direct import to the browser without retaining an anchor href", async () => {
    const assign = vi.fn();
    const createMigrationUrl = vi.fn(() => MIGRATION_URL);
    vi.stubGlobal("location", { assign, href: "http://localhost/" });
    render(<MigrateToPubkyRing createMigrationUrl={createMigrationUrl} onBack={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Import pubky" }));

    expect(createMigrationUrl).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith(MIGRATION_URL);
    expect(screen.queryByRole("link", { name: "Import pubky" })).not.toBeInTheDocument();
  });
});
