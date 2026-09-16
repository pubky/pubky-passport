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

    fireEvent.click(screen.getByRole("button", { name: "Copy Lightning invoice" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Copy Lightning invoice" }));
    await waitFor(() =>
      expect(MOCKS.toastInfo).toHaveBeenCalledWith("Could not copy invoice", {
        description: "Select and copy the invoice manually.",
      }),
    );
    expect(MOCKS.toastInfo).not.toHaveBeenCalledWith("Invoice copied to clipboard");
    expect(screen.getByText(invoice.bolt11Invoice)).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Lightning wallet" })).toHaveAttribute(
      "href",
      `lightning:${invoice.bolt11Invoice}`,
    );
  });
});
