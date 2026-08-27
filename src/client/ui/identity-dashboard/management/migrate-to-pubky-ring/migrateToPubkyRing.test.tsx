/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MigrateToPubkyRing } from "./migrateToPubkyRing";

const MIGRATION_URL = "pubkyring://migrate?index=0&total=1&key=0123456789abcdef";

describe("MigrateToPubkyRing", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the pixel-accurate desktop card with a live migration QR", async () => {
    const createMigrationUrl = vi.fn(() => Result.ok(MIGRATION_URL));
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    })));
    render(<MigrateToPubkyRing createMigrationUrl={createMigrationUrl} navigationAction="back" onBack={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Download Pubky Ring on the App Store" }))
      .toHaveAttribute("href", "https://apps.apple.com/us/app/pubky-ring/id6739356756");
    expect(screen.getByRole("link", { name: "Get Pubky Ring on Google Play" }))
      .toHaveAttribute("href", "https://play.google.com/store/apps/details?id=to.pubky.ring&hl=en-US");
    expect(screen.getByRole("button", { name: "Import pubky" })).not.toHaveAttribute("href");
    expect(screen.queryByRole("button", { name: "Continue with Pubky Ring" })).not.toBeInTheDocument();
    expect(screen.getByAltText("Pubky Ring")).toHaveClass("h-[30px]", "w-[137px]");
    expect(screen.getByAltText("Download on the App Store")).toHaveClass("md:h-10", "md:w-[120px]");
    expect(screen.getByAltText("Get it on Google Play")).toHaveClass("md:h-10", "md:w-[135px]");
    expect(screen.getByText("Scan this QR with Pubky Ring to import and self-manage your pubky identity.")).toHaveClass("text-sm", "leading-5");
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
    const qrCode = await screen.findByRole("img", { name: "Pubky Ring migration QR code" });
    expect(qrCode).toHaveClass("size-full");
    expect(qrCode.parentElement).toHaveClass("inset-[4.66%]");
    expect(qrCode.parentElement?.parentElement).toHaveClass("size-48");
    expect(qrCode.parentElement?.parentElement?.parentElement).toHaveClass("rounded-2xl", "md:flex-row", "md:p-12");
    expect(qrCode.parentElement?.parentElement?.querySelector('img[src="/brand/pubky-brand-mark.svg"]')).toHaveAttribute("width", "15");
    await waitFor(() => expect(createMigrationUrl).toHaveBeenCalledOnce());
  });

  it("generates the URL on confirmation and unmounts the QR on close", async () => {
    const createMigrationUrl = vi.fn(() => Result.ok(MIGRATION_URL));
    render(<MigrateToPubkyRing createMigrationUrl={createMigrationUrl} navigationAction="back" onBack={vi.fn()} />);

    const showQr = screen.getByRole("button", { name: "Show QR" });
    await userEvent.setup().click(showQr);

    expect(createMigrationUrl).toHaveBeenCalledOnce();
    const dialog = screen.getByRole("dialog", { name: "Scan with Pubky Ring" });
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveClass("w-full", "max-w-none");
    const qrCode = screen.getByRole("img", { name: "Pubky Ring migration QR code" });
    expect(qrCode).toHaveClass("size-full");
    expect(dialog.querySelector('img[src="/brand/pubky-brand-mark.svg"]')).toHaveAttribute("width", "15");
    expect(dialog.querySelector('img[src="/brand/pubky-brand-mark.svg"]')).toHaveAttribute("height", "24");
    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
  });

  it("closes the mobile QR drawer when the desktop inline QR takes over", async () => {
    let desktop = false;
    let breakpointListener: (() => void) | undefined;
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      addEventListener: vi.fn((_event: string, listener: () => void) => { breakpointListener = listener; }),
      get matches() { return desktop; },
      removeEventListener: vi.fn(),
    })));
    render(<MigrateToPubkyRing createMigrationUrl={() => Result.ok(MIGRATION_URL)} navigationAction="back" onBack={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR" }));
    expect(screen.getByRole("dialog", { name: "Scan with Pubky Ring" })).toBeInTheDocument();

    desktop = true;
    act(() => breakpointListener?.());

    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pubky Ring migration QR code" })).toBeInTheDocument();
  });

  it("shows Back for identity management and clears the QR URL when leaving", () => {
    const onBack = vi.fn();
    render(<MigrateToPubkyRing createMigrationUrl={() => Result.ok(MIGRATION_URL)} navigationAction="back" onBack={onBack} />);

    fireEvent.click(screen.getByRole("button", { name: "Show QR" }));
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
  });

  it("shows Continue for the Google detachment recovery flow", () => {
    const onBack = vi.fn();
    render(<MigrateToPubkyRing createMigrationUrl={() => Result.ok(MIGRATION_URL)} navigationAction="continue" onBack={onBack} />);

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("hands direct import to the browser without retaining an anchor href", async () => {
    const assign = vi.fn();
    const createMigrationUrl = vi.fn(() => Result.ok(MIGRATION_URL));
    vi.stubGlobal("location", { assign, href: "http://localhost/" });
    render(<MigrateToPubkyRing createMigrationUrl={createMigrationUrl} navigationAction="back" onBack={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Import pubky" }));

    expect(createMigrationUrl).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith(MIGRATION_URL);
    expect(screen.queryByRole("link", { name: "Import pubky" })).not.toBeInTheDocument();
  });

  it("shows an export failure from the structured result", async () => {
    render(<MigrateToPubkyRing createMigrationUrl={() => Result.err({ code: "storage_unavailable" })} navigationAction="back" onBack={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR" }));

    expect(screen.getByText("The active Pubky could not be exported.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
  });
});
