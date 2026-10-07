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
import { SetupProgressProvider, SetupProgressSlot } from "@/client/ui/shared/setupProgress";
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
      <SetupProgressSlot />
      <SetupProgressProvider current={1}>
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

  it("asks a computer to scan, with what to do in the app beside the code and only Back to press", () => {
    usePointer(false);
    renderStep();

    // Either keychain app takes the same code, so the step names neither alone.
    expect(screen.getByRole("heading", { name: "Scan QR with keychain." })).toBeInTheDocument();
    expect(
      screen.getByText("Use Pubky Ring or Bitkit and follow the instructions below."),
    ).toBeInTheDocument();
    // Passport watches the invite without a line saying it waits.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Waiting for|asks you twice/u)).toBeNull();
    // Passport goes on by itself once the invite is used: no button to go on by hand.
    expect(screen.queryByRole("button", { name: "Continue to profile" })).toBeNull();
    // The code and the steps to take in the app share one card, the code first.
    const card = screen.getByRole("region", { name: "Keychain signup" });
    const code = within(card).getByRole("img", { name: "Keychain signup QR code" });
    const steps = within(card).getByRole("list");
    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((step) => step.textContent),
    ).toEqual(["Open Pubky Ring or Bitkit", "Tap ‘Scan’", "Scan this QR", "Authorize in the app"]);
    expect(code.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A computer cannot open the keychain's link, so it gets no button for it.
    expect(screen.queryByRole("link", { name: "Authorize & configure" })).toBeNull();
    const back = screen.getByRole("button", { name: "Back" });
    expect(card.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(screen.getByRole("heading", { name: "Scan QR with keychain." })).toBeInTheDocument();
    // A lookup without an answer doubles the wait before the next one.
    await act(() => vi.advanceTimersByTimeAsync(SIGNUP_TOKEN_WATCH_INTERVAL_MS));
    expect(screen.getByRole("heading", { name: "Scan QR with keychain." })).toBeInTheDocument();
    expect(MOCKS.toastSuccess).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(SIGNUP_TOKEN_WATCH_INTERVAL_MS));

    expect(screen.getByRole("heading", { name: "Connect your keychain." })).toBeInTheDocument();
    expect(MOCKS.toastSuccess).toHaveBeenCalledWith("Account created in your keychain");
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

  it("does not look the invite up while the page is hidden, and looks at once on return", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    usePointer(false);
    const checkSignupToken = vi.fn<SignupTokenCheck>().mockResolvedValue("used");
    renderStep(checkSignupToken, waitingRing());
    const showPage = (state: DocumentVisibilityState) =>
      act(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
        document.dispatchEvent(new Event("visibilitychange"));
      });

    // A phone that switched to the keychain app leaves this page hidden: nothing is asked meanwhile.
    showPage("hidden");
    await act(() => vi.advanceTimersByTimeAsync(SIGNUP_TOKEN_WATCH_INTERVAL_MS * 5));
    expect(checkSignupToken).not.toHaveBeenCalled();

    showPage("visible");
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(checkSignupToken).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Connect your keychain." })).toBeInTheDocument();
  });

  it("keeps a phone on its one link when the keychain did not open, without a QR code", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    usePointer(true);
    renderStep();
    expect(screen.getByRole("heading", { name: "Authorize with keychain." })).toBeInTheDocument();
    const lead = "Tap below to open your keychain and automatically configure your pubky.";
    expect(screen.getByText(lead)).toBeInTheDocument();
    // Both apps take the link, so the card shows both over its one button.
    const card = screen.getByRole("region", { name: "Keychain signup" });
    expect(within(card).getByRole("img", { name: "Pubky Ring" })).toBeInTheDocument();
    expect(within(card).getByRole("img", { name: "Bitkit" })).toBeInTheDocument();

    const link = within(card).getByRole("link", { name: "Authorize & configure" });
    expect(link).toHaveAttribute("href", expect.stringMatching(/^pubkyauth:/u));
    link.addEventListener("click", (event) => event.preventDefault());
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(link);
    act(() => vi.advanceTimersByTime(2_000));

    // The same link to try again, the same instruction, and no code a phone could not scan.
    expect(screen.getByRole("link", { name: "Authorize & configure" })).toBe(link);
    expect(screen.getByText(lead)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Keychain signup QR code" })).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue to profile" })).toBeNull();
  });

  it("marks Profile as the current step while the keychain connects the new account's profile", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    usePointer(false);
    const checkSignupToken = vi.fn<SignupTokenCheck>().mockResolvedValue("used");
    renderStep(checkSignupToken, waitingRing());
    const stepper = () => screen.getByRole("navigation", { name: "Account setup progress" });
    expect(stepper()).toHaveTextContent("Step 2 of 3: Identity keys");

    await act(() => vi.advanceTimersByTimeAsync(SIGNUP_TOKEN_WATCH_INTERVAL_MS));
    expect(screen.getByRole("heading", { name: "Connect your keychain." })).toBeInTheDocument();
    expect(stepper()).toHaveTextContent("Step 3 of 3: Profile");
  });
});
