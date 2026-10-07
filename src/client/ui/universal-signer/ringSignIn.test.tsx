/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeepLinkLauncher } from "@/client/logic/universal-signer/deepLinkLauncher";
import { bindTestOpener, releaseTestOpener } from "@test-utils/boundOpener";
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
      onBack={vi.fn()}
      review={review}
    />,
  );
}

describe("RingSignIn", () => {
  beforeEach(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    // The app's popup, whose v2 hello bound the request: the hand-off names the app.
    bindTestOpener("https://notes.example");
  });

  afterEach(() => {
    cleanup();
    releaseTestOpener();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps a phone to its link to Pubky Ring, also when Ring did not open, without a QR code", () => {
    vi.useFakeTimers();
    usePointer(true);
    renderRingSignIn(launchedFromPhone());

    expect(screen.getByText(/Choose an identity in Pubky Ring/u)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2_000));
    // Ring did not open: the phone keeps its one button to try again, and gets no code to scan.
    expect(screen.queryByRole("img", { name: "Pubky authorization QR code" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open Pubky Ring" })).toBeInTheDocument();
    expect(screen.getByText(/Choose an identity in Pubky Ring/u)).toBeInTheDocument();
    expect(screen.queryByText(/Scan this code/u)).toBeNull();
    // Nobody reports an approval here: Back is the only control.
    expect(screen.queryByRole("button", { name: /approved/iu })).toBeNull();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("leads with the QR code on a computer, with only Back, and flags broad access", () => {
    usePointer(false);
    renderRingSignIn(undefined, {
      ...REVIEW,
      capabilities: [{ path: "/", read: true, write: true, scope: "broad" }],
    });

    expect(screen.getByRole("img", { name: "Pubky authorization QR code" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approved|Back to/iu })).toBeNull();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("access to all your data");
  });

  it("watches for Ring's answer while it is shown, with no line saying it waits", () => {
    usePointer(false);
    const stop = vi.fn();
    const watchApproval = vi.fn(() => stop);
    const props = {
      getAuthorizationUrl: () => REQUEST,
      launcher: undefined,
      onBack: vi.fn(),
      review: REVIEW,
    };
    const { rerender, unmount } = render(<RingSignIn {...props} watchApproval={watchApproval} />);

    expect(watchApproval).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Waiting for|continues by itself/u)).toBeNull();
    // A new render does not restart the watch.
    rerender(<RingSignIn {...props} watchApproval={() => vi.fn()} />);
    expect(watchApproval).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
    unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("names Pubky Ring or Bitkit for a grant request, Pubky Ring alone for a legacy one", () => {
    releaseTestOpener();
    usePointer(false);
    renderRingSignIn(undefined, { ...REVIEW, authenticationMethod: "grant" });
    expect(screen.getByText(/approve the sign-in/u)).toHaveTextContent(
      "Scan this code with Pubky Ring or Bitkit on your phone, then choose an identity and approve the sign-in.",
    );
  });

  it("never names a request nobody verified after its label or website, and warns (M3)", () => {
    releaseTestOpener();
    usePointer(false);
    renderRingSignIn(undefined, { ...REVIEW, requesterName: "Pubky App" });

    expect(screen.queryByText(/Pubky App|notes\.example/u)).not.toBeInTheDocument();
    expect(screen.getByText(/approve the sign-in/u)).toHaveTextContent(
      "Scan this code with Pubky Ring on your phone, then choose an identity and approve the sign-in.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Passport can’t confirm who sent this request.",
    );
  });

  it("names no label for a bound request without a website, and needs no warning", () => {
    usePointer(false);
    renderRingSignIn(undefined, {
      authenticationMethod: "cookie",
      capabilities: REVIEW.capabilities,
      requesterName: "Pubky App",
    });

    // The band names the bound opener; the instruction names no label it chose itself.
    expect(screen.queryByText(/Pubky App/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the website alone when the label is the website, isolated from the sentence", () => {
    usePointer(false);
    renderRingSignIn(undefined, { ...REVIEW, requesterName: "notes.example" });

    const instruction = screen.getByText(/approve the sign-in/u);
    expect(instruction).toHaveTextContent("approve the sign-in to notes.example.");
    expect(instruction.querySelector("bdi")).toHaveTextContent("notes.example");
    expect(screen.queryByText(/can’t confirm who sent this request/u)).not.toBeInTheDocument();
  });

  it("shows a label's long stack of combining marks cut to a few", () => {
    usePointer(false);
    renderRingSignIn(undefined, { ...REVIEW, requesterName: `Acme${"\u0332".repeat(80)}` });

    expect(screen.getByText(/approve the sign-in/u).querySelector("bdi")?.textContent).toBe(
      `Acme${"\u0332".repeat(3)}`,
    );
  });

  it("says where to get Pubky Ring, and nothing about waiting, where Passport cannot watch", () => {
    usePointer(false);
    renderRingSignIn(undefined);

    expect(
      screen.getByRole("heading", { level: 1, name: "Sign in with Pubky Ring." }),
    ).toBeInTheDocument();
    // The app finishes the sign-in when Ring's answer reaches it; the screen stays until then.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Once you approve|signs you in/u)).toBeNull();
    expect(screen.queryByRole("button", { name: /approved/iu })).toBeNull();
    expect(screen.getByText("Don't have Pubky Ring?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get Pubky Ring on Google Play" })).toBeInTheDocument();
  });
});
