/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LightningVerification } from "./lightningVerification";

const MOCKS = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: MOCKS.toastError, success: MOCKS.toastSuccess } }));

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

  it("asks a computer to scan and a phone to tap, under one window title", () => {
    renderInvoice();
    // Both wordings are in the page and the width shows one; the window keeps one title.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveAttribute("data-window-title", "Pay");
    expect(document.title).toBe("Pay | Pubky Passport");
    expect(within(heading).getByText("Scan to")).toHaveClass("hidden", "md:inline");
    expect(within(heading).getByText("Tap to")).toHaveClass("md:hidden");
    expect(within(heading).getByText("pay.")).toBeInTheDocument();
    expect(screen.getByText("Scan the QR with your favorite wallet.")).toHaveClass(
      "hidden",
      "md:inline",
    );
    expect(screen.getByText("Pay with your favorite bitcoin wallet.")).toHaveClass("md:hidden");
    // The code a computer scans, in the card with the payment.
    const card = screen.getByRole("region", { name: "Bitcoin Lightning payment" });
    expect(
      within(card).getByRole("img", { name: "Lightning payment invoice" }),
    ).toBeInTheDocument();
    expect(within(card).getByRole("heading", { name: "Bitcoin Lightning Payment" })).toBeVisible();
  });

  it.each([
    ["the invoice has expired", invoice, true],
    ["the invoice is still being created", null, false],
  ] as const)(
    "keeps the design's heading and lead, with no Pay Now or QR code, while %s",
    (_, shown, expired) => {
      render(
        <LightningVerification
          invoice={shown}
          expired={expired}
          pending={false}
          error={null}
          onBack={vi.fn()}
          onCreateInvoice={vi.fn()}
          onCheckPayment={vi.fn()}
        />,
      );
      // The design's words stay in every state; the card says what there is to do now.
      const heading = screen.getByRole("heading", { level: 1 });
      expect(within(heading).getByText("Scan to")).toBeInTheDocument();
      expect(within(heading).getByText("Tap to")).toBeInTheDocument();
      expect(within(heading).getByText("pay.")).toBeInTheDocument();
      expect(screen.queryByText(/Ready to/u)).toBeNull();
      expect(screen.getByText("Scan the QR with your favorite wallet.")).toBeInTheDocument();
      expect(screen.getByText("Pay with your favorite bitcoin wallet.")).toBeInTheDocument();
      expect(screen.queryByText("Pay the invoice with your favorite bitcoin wallet.")).toBeNull();
      // Neither Pay Now nor a code is on the screen now.
      expect(screen.queryByText(/Pay Now/u)).toBeNull();
      expect(screen.queryByRole("link", { name: /Pay Now/u })).toBeNull();
      expect(screen.queryByRole("img", { name: "Lightning payment invoice" })).toBeNull();
    },
  );

  it("says it waits for the payment and when the invoice expires, as a short local time", () => {
    renderInvoice();

    const expires = new Date(invoice.expiresAt).toLocaleTimeString([], { timeStyle: "short" });
    expect(
      within(screen.getByRole("region", { name: "Bitcoin Lightning payment" })).getByRole("status"),
    ).toHaveTextContent(`Waiting for payment · expires ${expires}`);
  });

  it("names the amount in sats, grouped the same way in every locale", () => {
    render(
      <LightningVerification
        invoice={{ ...invoice, amountSat: 1_000 }}
        expired={false}
        pending={false}
        error={null}
        onBack={vi.fn()}
        onCreateInvoice={vi.fn()}
        onCheckPayment={vi.fn()}
      />,
    );
    // ₿ stands for sats, as on pubky.app; a screen reader hears the unit in words.
    const amount = screen.getByText("₿ 1,000");
    expect(amount).toHaveAttribute("aria-label", "1,000 sats");
    expect(screen.getByText("Please pay ₿1,000 to continue.")).toBeVisible();
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
    expect(MOCKS.toastSuccess).not.toHaveBeenCalled();
    finishCopy();
    await waitFor(() =>
      expect(MOCKS.toastSuccess).toHaveBeenCalledWith("Invoice copied to clipboard"),
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
      expect(MOCKS.toastError).toHaveBeenCalledWith(
        "Could not copy invoice",
        expect.objectContaining({ description: "Select and copy the invoice manually." }),
      ),
    );
    expect(MOCKS.toastSuccess).not.toHaveBeenCalled();
    const manualCopy = screen.getByRole("textbox", { name: "Lightning invoice" });
    expect(manualCopy).toHaveTextContent(invoice.bolt11Invoice);
    expect(manualCopy).toHaveAttribute("aria-readonly", "true");
    // Read-only text, not a dashed box that looks like a field to type in.
    expect(manualCopy).not.toHaveClass("border-dashed");
  });

  it("shows the whole of a real-length invoice to copy by hand, selected at once", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("Clipboard unavailable")) },
    });
    // A BOLT11 invoice runs to several hundred characters.
    const bolt11Invoice = `lnbc10u1p5x7k2app5${"qg3w9z8n4v6t0e2c7m5r1y8u3a6s9d4f7h2j5k8l0".repeat(9)}gpd4c8tz`;
    render(
      <LightningVerification
        invoice={{ ...invoice, bolt11Invoice }}
        expired={false}
        pending={false}
        error={null}
        onBack={vi.fn()}
        onCreateInvoice={vi.fn()}
        onCheckPayment={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy Invoice" }));
    const manualCopy = await screen.findByRole("textbox", { name: "Lightning invoice" });
    // Text that wraps to its full length: no fixed number of rows or height that cuts it off.
    expect(manualCopy).toHaveTextContent(bolt11Invoice);
    expect(manualCopy.tagName).not.toBe("TEXTAREA");
    expect(manualCopy.className).not.toMatch(/(^|\s)(max-h-|h-\d|overflow-|line-clamp-|truncate)/u);
    expect(manualCopy).toHaveClass("break-all", "select-all");
    // Focusing it selects the whole invoice, ready to copy.
    fireEvent.focus(manualCopy);
    expect(window.getSelection()?.toString()).toBe(bolt11Invoice);
  });

  it("gives a phone Pay Now in the card, with Copy Invoice the action after Back", () => {
    renderInvoice();
    const card = screen.getByRole("region", { name: "Bitcoin Lightning payment" });
    const pay = within(card).getByRole("link", { name: "Pay Now" });
    expect(pay).toHaveAttribute("href", `lightning:${invoice.bolt11Invoice}`);
    // The phone's primary, in the card; a computer scans the QR code instead.
    expect(pay).toHaveClass("bg-brand/16", "md:hidden");
    const back = screen.getByRole("button", { name: "Back" });
    const copy = screen.getByRole("button", { name: "Copy Invoice" });
    expect(card).not.toContainElement(copy);
    expect(copy).not.toHaveClass("bg-brand/16");
    expect(back.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows only the check as busy while an expired invoice's payment is checked", async () => {
    function Harness() {
      const [pending, setPending] = useState(false);
      return (
        <LightningVerification
          invoice={invoice}
          expired
          pending={pending}
          error={null}
          onBack={vi.fn()}
          onCreateInvoice={vi.fn()}
          onCheckPayment={() => setPending(true)}
        />
      );
    }
    render(<Harness />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Check payment" }));

    const check = screen.getByRole("button", { name: "Checking payment…" });
    expect(check).toHaveAttribute("aria-busy", "true");
    expect(check).toHaveFocus();
    const create = screen.getByRole("button", { name: "Create new invoice" });
    expect(create).toBeDisabled();
    expect(create).not.toHaveAttribute("aria-busy");
  });

  it("moves focus to the new invoice when it replaces the expired one", async () => {
    let deliverInvoice!: () => void;
    function Harness() {
      const [pending, setPending] = useState(false);
      const [current, setCurrent] = useState({ invoice, expired: true });
      deliverInvoice = () => {
        setPending(false);
        setCurrent({ invoice: { ...invoice, id: "new-invoice" }, expired: false });
      };
      return (
        <LightningVerification
          invoice={current.invoice}
          expired={current.expired}
          pending={pending}
          error={null}
          onBack={vi.fn()}
          onCreateInvoice={() => setPending(true)}
          onCheckPayment={vi.fn()}
        />
      );
    }
    render(<Harness />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Create new invoice" }));
    expect(screen.getByRole("button", { name: "Creating invoice…" })).toHaveFocus();
    act(() => deliverInvoice());

    // The pressed button is gone with the expired card; focus lands on the invoice, not the page.
    expect(screen.queryByRole("button", { name: /invoice…$/u })).toBeNull();
    expect(screen.getByRole("heading", { name: "Bitcoin Lightning Payment" })).toHaveFocus();
  });

  it("offers no retry while the first invoice is created, and only the error after a failure", () => {
    const step = (pending: boolean, error: string | null) => (
      <LightningVerification
        invoice={null}
        expired={false}
        pending={pending}
        error={error}
        onBack={vi.fn()}
        onCreateInvoice={vi.fn()}
        onCheckPayment={vi.fn()}
        onUseInvite={vi.fn()}
      />
    );
    const { rerender } = render(step(true, null));
    expect(screen.queryByRole("button", { name: /Try again/u })).toBeNull();

    rerender(step(false, "Could not reach the verification service. Please try again."));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not reach the verification service.");
    expect(alert).toContainElement(screen.getByRole("button", { name: "Use an invite code" }));
    expect(screen.queryByText(/Your invoice could not be created/u)).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });
});
