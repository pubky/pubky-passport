/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LightningVerification } from "./lightningVerification";

const MOCKS = vi.hoisted(() => ({ toastInfo: vi.fn() }));
vi.mock("sonner", () => ({ toast: { info: MOCKS.toastInfo } }));

const invoice = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  amountSat: 100,
  bolt11Invoice: "lnbc100n1example",
  expiresAt: Date.now() + 60_000,
};

function renderInvoice() {
  render(
    <LightningVerification
      invoice={invoice}
      expired={false}
      pending={false}
      error={null}
      onBack={vi.fn()}
      onCreateInvoice={vi.fn()}
      onCheckPayment={vi.fn()}
    />,
  );
}

describe("LightningVerification", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("exposes one heading name and one description to assistive technology", () => {
    renderInvoice();
    expect(screen.getByRole("heading", { level: 1, name: "Scan to Pay." })).toBeInTheDocument();
    const description = screen.getByText("Pay the invoice with your favorite bitcoin wallet.");
    expect(description).toHaveClass("sr-only");
    for (const visual of [
      "Scan the QR code with your favorite wallet.",
      "Pay with your favorite bitcoin wallet.",
    ])
      expect(screen.getByText(visual)).toHaveAttribute("aria-hidden", "true");
  });

  it("confirms copying the invoice only after the clipboard succeeds", async () => {
    let finishCopy!: () => void;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCopy = resolve;
        }),
    );
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderInvoice();

    fireEvent.click(screen.getByRole("button", { name: "Copy Invoice" }));
    expect(writeText).toHaveBeenCalledWith(invoice.bolt11Invoice);
    expect(MOCKS.toastInfo).not.toHaveBeenCalled();
    finishCopy();
    await waitFor(() =>
      expect(MOCKS.toastInfo).toHaveBeenCalledWith("Invoice copied to clipboard"),
    );
  });

  it("shows a toast with a manual fallback when copying fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("Clipboard unavailable")) },
    });
    renderInvoice();

    fireEvent.click(screen.getByRole("button", { name: "Copy Invoice" }));
    await waitFor(() =>
      expect(MOCKS.toastInfo).toHaveBeenCalledWith("Could not copy invoice", {
        description: "Select and copy the invoice manually.",
      }),
    );
    expect(MOCKS.toastInfo).not.toHaveBeenCalledWith("Invoice copied to clipboard");
    expect(screen.getByText(invoice.bolt11Invoice)).toBeVisible();
    expect(screen.getByRole("link", { name: "Pay Now" })).toHaveAttribute(
      "href",
      `lightning:${invoice.bolt11Invoice}`,
    );
  });
});
