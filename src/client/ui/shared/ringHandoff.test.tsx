/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeepLinkLauncher } from "@/client/logic/universal-signer/deepLinkLauncher";
import { RingHandoff } from "./ringHandoff";

const REQUEST = "pubkyauth://signin?relay=https://relay.example/inbox&secret=exact-request";
const LARGE_REQUEST = `pubkyauth://signin?secret=s&caps=${Array.from(
  { length: 6 },
  (_, index) => `/pub/${"a".repeat(240)}/${"b".repeat(240)}/app${index}/:rw`,
).join(",")}`;
const LABELS = {
  section: "Sign in with Pubky Ring",
  qrCode: "Pubky authorization QR code",
  open: "Open Pubky Ring",
  tooLarge: "This request is too big for a QR code. Open it in Pubky Ring on this device.",
  unavailable: "This request is no longer available.",
};

function usePointer(coarse: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function fakeLauncher() {
  const assign = vi.fn();
  const appWindow = new Proxy(window, {
    get(target, property) {
      if (property === "location") return { assign };
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { assign, launcher: new DeepLinkLauncher(appWindow, 2_000) };
}

describe("RingHandoff", () => {
  beforeEach(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows the QR code at once on a fine pointer, without a link a computer cannot open", () => {
    usePointer(false);
    render(<RingHandoff labels={LABELS} url={REQUEST} />);

    expect(screen.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("region", { name: "Sign in with Pubky Ring" })).not.toHaveTextContent(
      "exact-request",
    );
  });

  it("opens Ring on a coarse pointer and falls back to the QR code while the page stays", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    usePointer(true);
    const { assign, launcher } = fakeLauncher();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<RingHandoff labels={LABELS} launcher={launcher} url={REQUEST} />);

    expect(screen.queryByRole("img", { name: "Pubky authorization QR code" })).toBeNull();
    // The live region is in the page before it has anything to say, so its message is announced.
    const status = document.querySelector('[aria-live="polite"]');
    expect(status).toBeInTheDocument();
    expect(status).toHaveClass("sr-only");
    expect(status).toBeEmptyDOMElement();
    const link = screen.getByRole("link", { name: "Open Pubky Ring" });
    expect(link).toHaveAttribute("href", REQUEST);
    // The link itself navigates; jsdom cannot, so only the watch that follows is exercised.
    link.addEventListener("click", (event) => event.preventDefault());
    await user.click(link);

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Opening Pubky Ring…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
    expect(screen.getByText(/Pubky Ring didn't open on this device/u)).toBe(status);
    expect(status).not.toHaveClass("sr-only");
    expect(screen.queryByRole("button", { name: /QR code/u })).toBeNull();
    expect(screen.getByRole("link", { name: "Open Pubky Ring" })).toHaveAttribute("href", REQUEST);
  });

  it("shows a launch that started before the card and lets a phone show the QR code on request", async () => {
    usePointer(true);
    const { launcher } = fakeLauncher();
    launcher.launch(REQUEST);
    render(<RingHandoff labels={LABELS} launcher={launcher} url={REQUEST} />);

    expect(screen.getByRole("link", { name: "Opening Pubky Ring…" })).toBeInTheDocument();
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByRole("link", { name: "Open Pubky Ring" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show QR code" }));
    expect(screen.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Hide QR code" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("offers only the deep link for a request too large for a QR code", () => {
    usePointer(false);
    render(<RingHandoff labels={LABELS} url={LARGE_REQUEST} />);

    expect(screen.getByText(LABELS.tooLarge)).toBeVisible();
    expect(screen.queryByRole("img", { name: "Pubky authorization QR code" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open Pubky Ring" })).toHaveAttribute(
      "href",
      LARGE_REQUEST,
    );
  });

  it("says when the request is gone", () => {
    render(<RingHandoff labels={LABELS} url={undefined} />);
    expect(screen.getByRole("alert")).toHaveTextContent(LABELS.unavailable);
  });
});
