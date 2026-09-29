/** @vitest-environment jsdom */

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RingProfileControllerPort } from "@/client/ui/passportCollaborators";
import { ACCOUNT_SETUP_STEPS, SetupProgressProvider } from "@/client/ui/shared/setupProgress";
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

  it("asks a computer to scan, with Install Pubky Ring as a side action after the way on", () => {
    usePointer(false);
    renderStep();

    expect(screen.getByRole("heading", { name: "Scan QR Code." })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pubky Ring signup QR code" })).toBeInTheDocument();
    expect(screen.getByText(/After creating your account in Ring/u)).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Continue to profile" });
    const install = screen.getByRole("button", { name: "Install Pubky Ring" });
    expect(install.closest('[data-slot="tertiary-actions"]')).not.toBeNull();
    expect(install).toHaveClass("underline");
    expect(next.compareDocumentPosition(install) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it("marks Profile as the current step while Ring connects the new account's profile", async () => {
    usePointer(false);
    const ring = {
      start: vi.fn(() => new Promise<never>(() => undefined)),
      poll: vi.fn(),
      confirm: vi.fn(),
      authorizationUrl: () => "pubkyauth://signin?secret=profile",
      isConnected: () => false,
      dispose: vi.fn(),
    } as unknown as RingProfileControllerPort;
    render(
      <SetupProgressProvider steps={ACCOUNT_SETUP_STEPS} current={1}>
        <RingSignupStep
          invite={INVITE}
          onBack={vi.fn()}
          onComplete={vi.fn()}
          profileController={ring}
        />
      </SetupProgressProvider>,
    );
    const current = () =>
      within(screen.getByRole("navigation", { name: "Account setup progress" }))
        .getAllByRole("listitem")
        .find((step) => step.getAttribute("aria-current") === "step");
    expect(current()).toHaveTextContent("Keys");

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue to profile" }));
    expect(screen.getByRole("heading", { name: "Connect your Ring." })).toBeInTheDocument();
    expect(current()).toHaveTextContent("Profile");
  });
});
