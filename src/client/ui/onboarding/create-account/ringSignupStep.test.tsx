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

  it("asks a computer to scan, with the store badges in the code's card and only Back to press", () => {
    usePointer(false);
    renderStep();

    // One heading for both pointers: the step creates the account, in Pubky Ring.
    expect(
      screen.getByRole("heading", { name: "Create your account in Pubky Ring." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/tap ‘Add Pubky’, then ‘Scan signup QR’/u)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pubky Ring signup QR code" })).toBeInTheDocument();
    // Passport watches the invite without a line saying it waits.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Waiting for|asks you twice/u)).toBeNull();
    // Passport goes on by itself once the invite is used: no button to go on by hand.
    expect(screen.queryByRole("button", { name: "Continue to profile" })).toBeNull();
    expect(screen.queryByText(/After creating your account in Ring/u)).not.toBeInTheDocument();
    // The store links replace a detour through a separate install step: under the code, in its
    // card, and before Back.
    const card = screen.getByRole("region", { name: "Pubky Ring signup" });
    const code = within(card).getByRole("img", { name: "Pubky Ring signup QR code" });
    const store = within(card).getByRole("link", { name: "Download Pubky Ring on the App Store" });
    expect(code.compareDocumentPosition(store) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install Pubky Ring" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Install it" })).toBeNull();
    const back = screen.getByRole("button", { name: "Back" });
    expect(store.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(
      screen.getByRole("heading", { name: "Create your account in Pubky Ring." }),
    ).toBeInTheDocument();
    // A lookup without an answer doubles the wait before the next one.
    await act(() => vi.advanceTimersByTimeAsync(SIGNUP_TOKEN_WATCH_INTERVAL_MS));
    expect(
      screen.getByRole("heading", { name: "Create your account in Pubky Ring." }),
    ).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(SIGNUP_TOKEN_WATCH_INTERVAL_MS));

    expect(screen.getByRole("heading", { name: "Connect Pubky Ring." })).toBeInTheDocument();
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

    // A phone that switched to Pubky Ring leaves this page hidden: nothing is asked meanwhile.
    showPage("hidden");
    await act(() => vi.advanceTimersByTimeAsync(SIGNUP_TOKEN_WATCH_INTERVAL_MS * 5));
    expect(checkSignupToken).not.toHaveBeenCalled();

    showPage("visible");
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(checkSignupToken).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Connect Pubky Ring." })).toBeInTheDocument();
  });

  it("keeps a phone on its one link when Pubky Ring did not open, without a QR code", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    usePointer(true);
    renderStep();
    expect(
      screen.getByRole("heading", { name: "Create your account in Pubky Ring." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Continue in Pubky Ring or Bitkit on this phone/u)).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "Continue with Pubky Ring or Bitkit" });
    link.addEventListener("click", (event) => event.preventDefault());
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(link);
    act(() => vi.advanceTimersByTime(2_000));

    // The same link to try again, the same instruction, and no code a phone could not scan.
    expect(screen.getByRole("link", { name: "Continue with Pubky Ring or Bitkit" })).toBe(link);
    expect(screen.getByText(/Continue in Pubky Ring or Bitkit on this phone/u)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Pubky Ring signup QR code" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue to profile" })).toBeNull();
  });

  it("marks Profile as the current step while Ring connects the new account's profile", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    usePointer(false);
    const checkSignupToken = vi.fn<SignupTokenCheck>().mockResolvedValue("used");
    renderStep(checkSignupToken, waitingRing());
    const current = () =>
      within(screen.getByRole("navigation", { name: "Account setup progress" }))
        .getAllByRole("listitem")
        .find((step) => step.getAttribute("aria-current") === "step");
    expect(current()).toHaveTextContent("Account");

    await act(() => vi.advanceTimersByTimeAsync(SIGNUP_TOKEN_WATCH_INTERVAL_MS));
    expect(screen.getByRole("heading", { name: "Connect Pubky Ring." })).toBeInTheDocument();
    expect(current()).toHaveTextContent("Profile");
  });
});
