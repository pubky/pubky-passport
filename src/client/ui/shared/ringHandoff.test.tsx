/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeepLinkLauncher } from "@/client/logic/universal-signer/deepLinkLauncher";
import { RingHandoff } from "./ringHandoff";
import { RingHandoffScreen } from "./ringHandoffScreen";

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
    expect(document.querySelector('a[href^="pubkyauth:"]')).toBeNull();
    expect(screen.getByRole("region", { name: "Sign in with Pubky Ring" })).not.toHaveTextContent(
      "exact-request",
    );
  });

  it("is one card on a screen of its own: the scan illustration, and the store badges centred under the code", () => {
    usePointer(false);
    const { container } = render(<RingHandoff labels={LABELS} url={REQUEST} />);

    const card = screen.getByRole("region", { name: "Sign in with Pubky Ring" });
    expect(card).toHaveClass("rounded-md", "bg-card");
    // The illustration the choice cards show for Pubky Ring, from lg, decoration only.
    const illustration = container.querySelector('img[src*="scan.png"]');
    expect(illustration).toHaveAttribute("aria-hidden", "true");
    expect(illustration).toHaveClass("hidden", "lg:block", "self-start");
    // Where to get Pubky Ring is part of the card, centred under the code, and the question is
    // left to screen readers.
    const install = card.querySelector('[data-slot="ring-install"]')!;
    expect(install).toHaveClass("items-center");
    expect(install.querySelector("p")).toHaveClass("sr-only");
    expect(install.querySelector("p")).toHaveTextContent("Don't have Pubky Ring?");
    expect(install.lastElementChild).toHaveClass("justify-center");
    expect(
      screen.getByRole("link", { name: "Download Pubky Ring on the App Store" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Get Pubky Ring on Google Play" })).toBeVisible();
    // Store pages open beside Passport, so the hand-off stays where it was.
    expect(
      screen.getByRole("link", { name: "Download Pubky Ring on the App Store" }),
    ).toHaveAttribute("target", "_blank");
    const qr = screen.getByRole("img", { name: "Pubky authorization QR code" });
    expect(qr.compareDocumentPosition(install) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(install.parentElement).toHaveClass("items-center");
  });

  it("starts on the text edge, without a surface or illustration, inside a card that names Pubky Ring", () => {
    usePointer(false);
    const { container } = render(
      <RingHandoffScreen action="Sign in with" embedded instruction="Scan." navigation={null}>
        <RingHandoff labels={LABELS} url={REQUEST} />
      </RingHandoffScreen>,
    );

    const card = screen.getByRole("region", { name: "Sign in with Pubky Ring" });
    expect(card).not.toHaveClass("bg-card");
    expect(container.querySelector('img[src*="scan.png"]')).toBeNull();
    const install = card.querySelector('[data-slot="ring-install"]')!;
    expect(install).toHaveClass("items-start");
    expect(install.lastElementChild).toHaveClass("justify-start");
    expect(install.parentElement).toHaveClass("items-start");
  });

  it("turns a spent request into the blurred code on a computer, which starts a new one", async () => {
    usePointer(false);
    const onRetry = vi.fn();
    render(<RingHandoff labels={LABELS} spent={{ onRetry }} url={REQUEST} />);

    // The spent link is not drawn: only the stand-in, in the code's place, with its tag.
    expect(screen.queryByRole("img", { name: "Pubky authorization QR code" })).toBeNull();
    expect(screen.getByText("Click to reload")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reload sign-in QR code" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("turns a spent request into Try again on a phone, in the button's place", async () => {
    usePointer(true);
    const onRetry = vi.fn();
    render(<RingHandoff labels={LABELS} spent={{ onRetry }} url={REQUEST} />);

    expect(document.querySelector('a[href^="pubkyauth:"]')).toBeNull();
    expect(screen.queryByText("Click to reload")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("gives a phone one button and never a QR code, whatever became of the launch", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    usePointer(true);
    const { assign, launcher } = fakeLauncher();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<RingHandoff labels={LABELS} launcher={launcher} url={REQUEST} />);
    const section = screen.getByRole("region", { name: "Sign in with Pubky Ring" });
    const onlyAction = () => {
      // One control besides the store badges, and no code, in every state.
      expect(section.querySelectorAll('a[href^="pubkyauth:"], button')).toHaveLength(1);
      expect(screen.queryByRole("img", { name: /QR code/u })).toBeNull();
    };

    onlyAction();
    const link = screen.getByRole("link", { name: "Open Pubky Ring" });
    expect(link).toHaveAttribute("href", REQUEST);
    // The link itself navigates; jsdom cannot, so only the watch that follows is exercised.
    link.addEventListener("click", (event) => event.preventDefault());
    await user.click(link);

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Opening Pubky Ring…" })).toBe(link);
    expect(link).toHaveAttribute("aria-busy", "true");
    onlyAction();
    // The page stayed in view: Ring did not open. The same button offers another try, with the
    // same link; nothing else appears.
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("link", { name: "Open Pubky Ring" })).toBe(link);
    expect(link).not.toHaveAttribute("aria-busy");
    expect(link).toHaveAttribute("href", REQUEST);
    expect(screen.queryByText(/didn't open/u)).toBeNull();
    onlyAction();
  });

  it("keeps a phone's button as it was when the page comes back from Pubky Ring", () => {
    usePointer(true);
    const { launcher } = fakeLauncher();
    launcher.launch(REQUEST);
    render(<RingHandoff labels={LABELS} launcher={launcher} url={REQUEST} />);

    const link = screen.getByRole("link", { name: "Opening Pubky Ring…" });
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(screen.getByRole("link", { name: "Open Pubky Ring" })).toBe(link);
    expect(screen.queryByRole("img", { name: /QR code/u })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("holds a phone's button in place while the link is made, then follows it once, from the press", () => {
    usePointer(true);
    const { assign, launcher } = fakeLauncher();
    const { rerender } = render(
      <RingHandoff labels={LABELS} launcher={launcher} openOnReady preparing url={undefined} />,
    );

    // Busy in the place it keeps, so nothing moves when the link arrives.
    const placeholder = screen.getByRole("button", { name: "Opening Pubky Ring…" });
    expect(placeholder).toBeDisabled();
    expect(placeholder).toHaveAttribute("aria-busy", "true");
    expect(assign).not.toHaveBeenCalled();

    rerender(<RingHandoff labels={LABELS} launcher={launcher} openOnReady url={REQUEST} />);
    expect(assign).toHaveBeenCalledExactlyOnceWith(REQUEST);
    expect(screen.getByRole("link", { name: "Opening Pubky Ring…" })).toHaveAttribute(
      "href",
      REQUEST,
    );
    // Rendering again with the same link follows nothing more: one request, one launch.
    rerender(<RingHandoff labels={LABELS} launcher={launcher} openOnReady url={REQUEST} />);
    expect(assign).toHaveBeenCalledOnce();
  });

  it("waits for the next press when the one that asked no longer counts", () => {
    usePointer(true);
    vi.stubGlobal("navigator", { ...navigator, userActivation: { isActive: false } });
    const { assign, launcher } = fakeLauncher();
    render(<RingHandoff labels={LABELS} launcher={launcher} openOnReady url={REQUEST} />);

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Open Pubky Ring" })).toHaveAttribute("href", REQUEST);
  });

  it("never follows the link on a computer, which shows the code instead", () => {
    usePointer(false);
    const { assign, launcher } = fakeLauncher();
    render(<RingHandoff labels={LABELS} launcher={launcher} openOnReady url={REQUEST} />);

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
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
