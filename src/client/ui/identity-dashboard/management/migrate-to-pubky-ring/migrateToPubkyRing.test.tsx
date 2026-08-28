/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Keypair } from "@synonymdev/pubky";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PubkyRingMigration } from "../../../../logic/pubky/PubkySdkAdapter";
import { MigrateToPubkyRing } from "./migrateToPubkyRing";

const MIGRATION_URL = "pubkyring://000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

function createMigrationHandle(): PubkyRingMigration {
  return new PubkyRingMigration(Keypair.fromSecret(
    Uint8Array.from({ length: 32 }, (_, index) => index),
  ));
}

describe("MigrateToPubkyRing", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the pixel-accurate desktop card with a live migration QR", async () => {
    const createMigration = vi.fn(() => Result.ok(createMigrationHandle()));
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    })));
    render(<MigrateToPubkyRing createMigration={createMigration} navigationAction="back" onBack={vi.fn()} />);

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
    await waitFor(() => expect(createMigration).toHaveBeenCalledOnce());
  });

  it("generates the URL on confirmation and unmounts the QR on close", async () => {
    const handle = createMigrationHandle();
    const dispose = vi.spyOn(handle, "dispose");
    const createMigration = vi.fn(() => Result.ok(handle));
    render(<MigrateToPubkyRing createMigration={createMigration} navigationAction="back" onBack={vi.fn()} />);

    const showQr = screen.getByRole("button", { name: "Show QR" });
    await userEvent.setup().click(showQr);

    expect(createMigration).toHaveBeenCalledOnce();
    const dialog = screen.getByRole("dialog", { name: "Scan with Pubky Ring" });
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveClass("w-full", "max-w-none");
    const qrCode = screen.getByRole("img", { name: "Pubky Ring migration QR code" });
    expect(qrCode).toHaveClass("size-full");
    expect(dialog.querySelector('img[src="/brand/pubky-brand-mark.svg"]')).toHaveAttribute("width", "15");
    expect(dialog.querySelector('img[src="/brand/pubky-brand-mark.svg"]')).toHaveAttribute("height", "24");
    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
    expect(dispose).toHaveBeenCalledOnce();
    expect(handle.url).toBeNull();
  });

  it("closes the mobile QR drawer when the desktop inline QR takes over", async () => {
    let desktop = false;
    let breakpointListener: (() => void) | undefined;
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      addEventListener: vi.fn((_event: string, listener: () => void) => { breakpointListener = listener; }),
      get matches() { return desktop; },
      removeEventListener: vi.fn(),
    })));
    render(<MigrateToPubkyRing createMigration={() => Result.ok(createMigrationHandle())} navigationAction="back" onBack={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR" }));
    expect(screen.getByRole("dialog", { name: "Scan with Pubky Ring" })).toBeInTheDocument();

    desktop = true;
    act(() => breakpointListener?.());

    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pubky Ring migration QR code" })).toBeInTheDocument();
  });

  it("shows Back for identity management and clears the QR URL when leaving", () => {
    const onBack = vi.fn();
    render(<MigrateToPubkyRing createMigration={() => Result.ok(createMigrationHandle())} navigationAction="back" onBack={onBack} />);

    fireEvent.click(screen.getByRole("button", { name: "Show QR" }));
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
  });

  it("shows Continue for the Google detachment recovery flow", () => {
    const onBack = vi.fn();
    render(<MigrateToPubkyRing createMigration={() => Result.ok(createMigrationHandle())} navigationAction="continue" onBack={onBack} />);

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("hands direct import to the browser without retaining an anchor href", async () => {
    const assign = vi.fn();
    const handle = createMigrationHandle();
    const navigate = vi.spyOn(handle, "navigate");
    const createMigration = vi.fn(() => Result.ok(handle));
    vi.stubGlobal("location", { assign, href: "http://localhost/" });
    render(<MigrateToPubkyRing createMigration={createMigration} navigationAction="back" onBack={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Import pubky" }));

    expect(createMigration).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith(MIGRATION_URL);
    expect(navigate).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link", { name: "Import pubky" })).not.toBeInTheDocument();
  });

  it("shows an export failure from the structured result", async () => {
    render(<MigrateToPubkyRing createMigration={() => Result.err({ code: "storage_unavailable" })} navigationAction="back" onBack={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR" }));

    expect(screen.getByText("The active Pubky could not be exported.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
  });
});
