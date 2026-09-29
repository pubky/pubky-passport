/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RingProfileControllerPort } from "@/client/ui/passportCollaborators";
import { RingSignupStep } from "./ringSignupStep";

const INVITE = {
  signupToken: "R1NG-5GNP-QW7X",
  homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
};

function usePointer(coarse: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function renderStep() {
  render(
    <RingSignupStep
      invite={INVITE}
      onBack={vi.fn()}
      onComplete={vi.fn()}
      profileController={{} as RingProfileControllerPort}
    />,
  );
}

describe("RingSignupStep", () => {
  beforeEach(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("asks a computer to scan, with the install link and the way on in one compact block", () => {
    usePointer(false);
    renderStep();

    expect(screen.getByRole("heading", { name: "Scan QR Code." })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pubky Ring signup QR code" })).toBeInTheDocument();
    const install = screen.getByRole("button", { name: "Install Pubky Ring" });
    expect(install.parentElement).toHaveTextContent(/After creating your account in Ring/u);
    expect(screen.getByRole("button", { name: "Continue to profile" })).toBeInTheDocument();
  });

  it("switches a phone to scanning once the link did not open Pubky Ring", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    usePointer(true);
    renderStep();
    expect(screen.getByRole("heading", { name: "Tap to Authorize." })).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "Continue with Pubky Ring" });
    link.addEventListener("click", (event) => event.preventDefault());
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(link);
    act(() => vi.advanceTimersByTime(2_000));

    expect(screen.getByRole("heading", { name: "Scan QR Code." })).toBeInTheDocument();
    expect(screen.getByText(/Open Pubky Ring on another phone/u)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pubky Ring signup QR code" })).toBeInTheDocument();
  });
});
