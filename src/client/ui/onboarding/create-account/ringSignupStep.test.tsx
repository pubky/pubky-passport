/** @vitest-environment jsdom */

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SignupTokenStatus } from "@/client/logic/pubky/SignupTokenChecker";
import { SIGNUP_TOKEN_WATCH_INTERVAL_MS } from "@/client/logic/signup/signupTokenWatcher";
import {
  PassportCollaboratorsProvider,
  type RingProfileControllerPort,
} from "@/client/ui/passportCollaborators";
import { ACCOUNT_SETUP_STEPS, SetupProgressProvider } from "@/client/ui/shared/setupProgress";
import { RingSignupStep } from "./ringSignupStep";

const MOCKS = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: MOCKS.toastSuccess } }));

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

/** A profile connection that waits in Ring for as long as a test needs. */
function waitingRing(): RingProfileControllerPort {
  return {
    start: vi.fn(() => new Promise<never>(() => undefined)),
    poll: vi.fn(),
    confirm: vi.fn(),
    authorizationUrl: () => "pubkyauth://signin?secret=profile",
    isConnected: () => false,
    dispose: vi.fn(),
  } as unknown as RingProfileControllerPort;
}

type SignupTokenCheck = (invite: typeof INVITE, signal: AbortSignal) => Promise<SignupTokenStatus>;

function renderStep(
  checkSignupToken = vi.fn<SignupTokenCheck>(async () => "valid"),
  profileController: RingProfileControllerPort = {} as RingProfileControllerPort,
) {
  const onBack = vi.fn();
  render(
    <PassportCollaboratorsProvider value={{ checkSignupToken }}>
      <SetupProgressProvider steps={ACCOUNT_SETUP_STEPS} current={1}>
        <RingSignupStep
          invite={INVITE}
          onBack={onBack}
          onComplete={vi.fn()}
          profileController={profileController}
        />
      </SetupProgressProvider>
    </PassportCollaboratorsProvider>,
  );
  return { checkSignupToken, onBack };
}

describe("RingSignupStep", () => {
  beforeEach(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("asks a computer to scan, offers the app first and waits for Ring, warning of two approvals", () => {
    usePointer(false);
    renderStep();

    expect(screen.getByRole("heading", { name: "Scan QR Code." })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Waiting for Pubky Ring. It asks you twice: to create the account, then to let Passport edit your profile.",
    );
    const qr = screen.getByRole("img", { name: "Pubky Ring signup QR code" });
    // Someone without the app needs it before the code can help.
    const install = screen.getByRole("button", { name: "Install it" });
    expect(install.compareDocumentPosition(qr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Passport notices the signup itself, so going on by hand is the secondary way.
    expect(screen.getByRole("button", { name: "I’ve finished in Pubky Ring" })).toHaveClass(
      "bg-secondary",
    );
    expect(screen.queryByText(/After creating your account in Ring/u)).not.toBeInTheDocument();
  });

  it("opens the profile connection once the homeserver reports the invite used", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    usePointer(false);
    const checkSignupToken = vi
      .fn<SignupTokenCheck>()
      .mockResolvedValueOnce("valid")
      .mockResolvedValueOnce("unknown")
      .mockResolvedValue("used");
    const { onBack } = renderStep(checkSignupToken, waitingRing());

    await act(() => vi.advanceTimersByTimeAsync(SIGNUP_TOKEN_WATCH_INTERVAL_MS * 2));
    expect(screen.getByRole("heading", { name: "Scan QR Code." })).toBeInTheDocument();
    // A lookup without an answer doubles the wait before the next one.
    await act(() => vi.advanceTimersByTimeAsync(SIGNUP_TOKEN_WATCH_INTERVAL_MS));
    expect(screen.getByRole("heading", { name: "Scan QR Code." })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(SIGNUP_TOKEN_WATCH_INTERVAL_MS));

    expect(screen.getByRole("heading", { name: "Connect your Ring." })).toBeInTheDocument();
    expect(MOCKS.toastSuccess).toHaveBeenCalledWith("Account created in Pubky Ring");
    expect(checkSignupToken).toHaveBeenCalledWith(INVITE, expect.any(AbortSignal));
    // The invite is spent, so Back leaves the Ring signup instead of showing its code again.
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
    const lookups = checkSignupToken.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(SIGNUP_TOKEN_WATCH_INTERVAL_MS * 3));
    expect(checkSignupToken).toHaveBeenCalledTimes(lookups);
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
    renderStep(undefined, waitingRing());
    const current = () =>
      within(screen.getByRole("navigation", { name: "Account setup progress" }))
        .getAllByRole("listitem")
        .find((step) => step.getAttribute("aria-current") === "step");
    expect(current()).toHaveTextContent("Keys");

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "I’ve finished in Pubky Ring" }));
    expect(screen.getByRole("heading", { name: "Connect your Ring." })).toBeInTheDocument();
    expect(current()).toHaveTextContent("Profile");
    // Finished by hand, the code may not be used yet, so Back returns to it.
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Scan QR Code." })).toBeInTheDocument();
  });
});
