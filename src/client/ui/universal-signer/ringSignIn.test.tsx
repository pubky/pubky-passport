/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeepLinkLauncher } from "@/client/logic/universal-signer/deepLinkLauncher";
import { RingSignIn } from "./ringSignIn";

const REQUEST = "pubkyauth://signin?relay=https://relay.example/inbox&secret=exact-request";
const REVIEW = {
  authenticationMethod: "cookie",
  capabilities: [{ path: "/pub/notes.example/", read: true, write: true, scope: "specific" }],
  callbackHost: "notes.example",
  requesterName: "Acme Notes",
} as const;

function usePointer(coarse: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

/** A launcher that already followed the link from the press that opened the screen. */
function launchedFromPhone() {
  const appWindow = new Proxy(window, {
    get(target, property) {
      if (property === "location") return { assign: vi.fn() };
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const launcher = new DeepLinkLauncher(appWindow, 2_000);
  launcher.launch(REQUEST);
  return launcher;
}

function renderRingSignIn(
  launcher: DeepLinkLauncher | undefined,
  review: Parameters<typeof RingSignIn>[0]["review"] = REVIEW,
) {
  render(
    <RingSignIn
      getAuthorizationUrl={() => REQUEST}
      launcher={launcher}
      onApproved={vi.fn()}
      onBack={vi.fn()}
      review={review}
    />,
  );
}

describe("RingSignIn", () => {
  beforeEach(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps I approved quiet while Pubky Ring opens, then scans once it did not open", () => {
    vi.useFakeTimers();
    usePointer(true);
    renderRingSignIn(launchedFromPhone());

    const approved = screen.getByRole("button", { name: "I approved in Pubky Ring" });
    // Nothing can have been approved yet, so the brand action is not offered next to "Opening…".
    expect(approved).toHaveClass("bg-secondary");
    expect(screen.getByText(/Choose an identity in Pubky Ring/u)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("img", { name: "Pubky authorization QR code" })).toBeInTheDocument();
    // This phone could not open Ring, so the code is for another one.
    expect(
      screen.getByText(/Scan this code with Pubky Ring on another phone/u),
    ).toBeInTheDocument();
    expect(approved).toHaveClass("bg-brand/16");
  });

  it("offers I approved as the next step once Pubky Ring took over the page", () => {
    usePointer(true);
    renderRingSignIn(launchedFromPhone());

    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByRole("button", { name: "I approved in Pubky Ring" })).toHaveClass(
      "bg-brand/16",
    );
  });

  it("leads with the QR code and I approved on a computer, and flags broad access", () => {
    usePointer(false);
    renderRingSignIn(undefined, {
      ...REVIEW,
      capabilities: [{ path: "/", read: true, write: true, scope: "broad" }],
    });

    expect(screen.getByRole("img", { name: "Pubky authorization QR code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I approved in Pubky Ring" })).toHaveClass(
      "bg-brand/16",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("access to all your data");
  });

  it("watches for Ring's answer while it is shown, and says Passport continues by itself", () => {
    usePointer(false);
    const stop = vi.fn();
    const watchApproval = vi.fn(() => stop);
    const props = {
      getAuthorizationUrl: () => REQUEST,
      launcher: undefined,
      onApproved: vi.fn(),
      onBack: vi.fn(),
      review: REVIEW,
    };
    const { rerender, unmount } = render(<RingSignIn {...props} watchApproval={watchApproval} />);

    expect(watchApproval).toHaveBeenCalledOnce();
    const status = screen.getByRole("status");
    expect(status.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(status).toHaveTextContent(
      "Waiting for your approval in Pubky Ring. Passport continues by itself once Acme Notes has it.",
    );
    // A new render does not restart the watch; the button stays as the secondary fallback.
    rerender(<RingSignIn {...props} watchApproval={() => vi.fn()} />);
    expect(watchApproval).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "I approved in Pubky Ring" })).toHaveClass(
      "bg-secondary",
    );
    expect(stop).not.toHaveBeenCalled();
    unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("says what follows the approval and where to get Pubky Ring, without a spinner", () => {
    usePointer(false);
    renderRingSignIn(undefined);

    expect(
      screen.getByRole("heading", { level: 1, name: "Sign in with Pubky Ring." }),
    ).toBeInTheDocument();
    // Without a relay Passport can watch, only the app waits for Ring's approval: nothing spins.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Once you approve in Pubky Ring, Acme Notes signs you in.");
    expect(status.querySelector('[data-slot="spinner"]')).toBeNull();
    // Only the person can then report the approval, so the button is the primary action.
    expect(screen.getByRole("button", { name: "I approved in Pubky Ring" })).not.toHaveClass(
      "bg-secondary",
    );
    expect(screen.getByText("Don't have Pubky Ring?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get Pubky Ring on Google Play" })).toBeInTheDocument();
  });
});
