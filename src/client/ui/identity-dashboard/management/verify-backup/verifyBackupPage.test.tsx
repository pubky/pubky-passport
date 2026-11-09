/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  RingVerificationErrorCode,
  RingVerificationProgress,
} from "@/client/logic/backup/RingBackupVerifier";
import type { LocalIdentityBackupCheckResult } from "@/client/logic/local-identity/LocalIdentityController";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import {
  KEYCHAIN_AUTH_METHOD_KEY,
  writeKeychainAuthMethod,
} from "@/client/logic/pubky/keychainAuthMethod";
import { formatBackupDate } from "@/client/ui/identity-dashboard/backupStatus";
import { VerifyBackupPage } from "./verifyBackupPage";
import { expectNoTextAssistance } from "@test-utils/passwordField";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const IDENTITY: LocalIdentityMetadata = { publicIdentity: { publicKeyZ32: KEY } };
const REQUEST = "pubkyauth://signin_grant?caps=&secret=verification-only";
const AT = new Date(Date.UTC(2026, 9, 1, 12));
const FILE_AT = "2026-09-01T10:00:00.000Z";
const RING_AT = "2026-09-20T10:00:00.000Z";
type Failure = { code: RingVerificationErrorCode };

const MOCKS = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: MOCKS.toastSuccess, info: vi.fn(), error: MOCKS.toastError },
}));

function verifier() {
  return {
    start: vi.fn(async (): Promise<Result<void, Failure>> => Result.ok()),
    poll: vi.fn(async (): Promise<Result<RingVerificationProgress, Failure>> =>
      Result.ok({ status: "waiting" }),
    ),
    authorizationUrl: vi.fn((): string | undefined => REQUEST),
    dispose: vi.fn(),
  };
}

function mount({
  identity = IDENTITY,
  ring = verifier(),
  verifyRecoveryFile = vi.fn(async (): Promise<LocalIdentityBackupCheckResult> => Result.ok()),
  onDone,
  skippable = false,
}: {
  identity?: LocalIdentityMetadata;
  ring?: ReturnType<typeof verifier>;
  verifyRecoveryFile?: ReturnType<typeof vi.fn>;
  onDone?: () => void;
  skippable?: boolean;
} = {}) {
  const callbacks = { onBack: vi.fn(), onFileVerified: vi.fn(), onRingVerified: vi.fn() };
  const view = render(
    <VerifyBackupPage
      identity={identity}
      onDone={onDone}
      skippable={skippable}
      verifier={ring}
      verifyRecoveryFile={verifyRecoveryFile as never}
      {...callbacks}
    />,
  );
  return { ...callbacks, ring, verifyRecoveryFile, ...view };
}

function stubCoarsePointer() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function backupFile() {
  return new File([new Uint8Array([1, 2, 3])], `pubky-${KEY}.pkarr`);
}

const fileCard = () => screen.getByRole("region", { name: "Recovery file" });
const ringCard = () => screen.getByRole("region", { name: "Pubky Ring" });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // The classic QR choice is kept for the device; no test inherits another's.
  writeKeychainAuthMethod("grant");
  localStorage.clear();
});

describe("VerifyBackupPage", () => {
  it("shows both checks on one page, the file first, side by side from 768px", async () => {
    mount();

    expect(screen.getByRole("heading", { level: 1, name: "Verify your backup." })).toBeVisible();
    const file = fileCard();
    const ring = ringCard();
    expect(file.compareDocumentPosition(ring)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(file.parentElement).toBe(ring.parentElement);
    expect(file.parentElement).toHaveClass("grid", "md:grid-cols-2");
    // The file card: its illustration, file picker, password field and its own button.
    expect(file.querySelector('img[src*="file.png"]')).not.toBeNull();
    expect(within(file).getByLabelText("Recovery file")).toBeInTheDocument();
    expect(within(file).getByLabelText("Recovery file password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expectNoTextAssistance(within(file).getByLabelText("Recovery file password"));
    expect(within(file).getByRole("button", { name: "Verify recovery file" })).toBeInTheDocument();
    expect(file).toHaveTextContent("Never checked");
    // The Ring card, on a computer: the code at once, no waiting line, and where to get Ring.
    expect(ring).toHaveTextContent("Never verified");
    expect(
      await within(ring).findByRole("img", { name: "Pubky Ring verification QR code" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(within(ring).queryByText("Generating QR code…")).toBeNull());
    expect(within(ring).queryByText(/Waiting for|Preparing your/u)).toBeNull();
    expect(within(ring).getByRole("link", { name: /App Store/u })).toBeInTheDocument();
    expect(within(ring).getByRole("link", { name: /Google Play/u })).toBeInTheDocument();
    expect(within(ring).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    // One way back, and no identity card: the page is about the checks.
    expect(screen.getAllByRole("button", { name: "Back" })).toHaveLength(1);
    expect(screen.queryByRole("region", { name: /Identity to/u })).not.toBeInTheDocument();
  });

  it("dates each check that passed before", () => {
    mount({
      identity: { ...IDENTITY, backup: { verifiedAt: FILE_AT, ringVerifiedAt: RING_AT } },
    });
    expect(fileCard()).toHaveTextContent(`Last checked ${formatBackupDate(new Date(FILE_AT))}`);
    expect(ringCard()).toHaveTextContent(`Last verified ${formatBackupDate(new Date(RING_AT))}`);
  });

  it("checks a recovery file in its card, saying what failed there, then goes back by itself", async () => {
    const verifyRecoveryFile = vi
      .fn()
      .mockResolvedValueOnce(Result.err({ code: "backup_decryption_failed" }))
      .mockResolvedValueOnce(Result.ok());
    const { onBack, onFileVerified, ring } = mount({ verifyRecoveryFile });
    const user = userEvent.setup();
    await within(ringCard()).findByRole("img", { name: "Pubky Ring verification QR code" });
    const file = fileCard();

    // Nothing picked yet: the card says so at the file field.
    await user.click(within(file).getByRole("button", { name: "Verify recovery file" }));
    expect(within(file).getByRole("alert")).toHaveTextContent(
      "Select your recovery file, pubky-1aeh1m…dddwdy.pkarr.",
    );
    await user.upload(within(file).getByLabelText("Recovery file"), backupFile());
    await user.type(within(file).getByLabelText("Recovery file password"), "wrong");
    await user.click(within(file).getByRole("button", { name: "Verify recovery file" }));
    expect(await within(file).findByRole("alert")).toHaveTextContent(
      "That password doesn’t open this file.",
    );
    expect(verifyRecoveryFile).toHaveBeenLastCalledWith(KEY, expect.any(Uint8Array), "wrong");
    // The password is cleared after every attempt.
    expect(within(file).getByLabelText("Recovery file password")).toHaveValue("");

    // A wrong password left Pubky Ring's request as it was: not restarted, its code in place.
    expect(ring.start).toHaveBeenCalledOnce();
    expect(
      within(ringCard()).getByRole("img", { name: "Pubky Ring verification QR code" }),
    ).toBeVisible();
    expect(MOCKS.toastError).not.toHaveBeenCalled();
    expect(ring.dispose).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();

    await user.type(within(file).getByLabelText("Recovery file password"), "right");
    await user.click(within(file).getByRole("button", { name: "Verify recovery file" }));
    // Passed: said with a toast, and the page goes back to where it was opened, by itself.
    await waitFor(() => expect(onBack).toHaveBeenCalledOnce());
    expect(onFileVerified).toHaveBeenCalledOnce();
    expect(MOCKS.toastSuccess).toHaveBeenCalledExactlyOnceWith("Recovery file verified");
  });

  it("goes back by itself once Pubky Ring signed with this key, saying so", async () => {
    const ring = verifier();
    ring.poll.mockResolvedValueOnce(Result.ok({ status: "verified", at: AT }));
    const { onBack, onRingVerified } = mount({ ring });

    await waitFor(() => expect(onBack).toHaveBeenCalledOnce());
    expect(ring.start).toHaveBeenCalledExactlyOnceWith(KEY, "grant");
    expect(onRingVerified).toHaveBeenCalledExactlyOnceWith(AT);
    expect(MOCKS.toastSuccess).toHaveBeenCalledExactlyOnceWith("Verified in Pubky Ring");
  });

  it("refuses an approval with another pubky in a toast, and starts again from the spent code", async () => {
    const ring = verifier();
    ring.poll.mockResolvedValueOnce(Result.err({ code: "wrong_identity" }));
    const { onRingVerified } = mount({ ring });

    await waitFor(() =>
      expect(MOCKS.toastError).toHaveBeenCalledExactlyOnceWith(
        "Pubky Ring approved with a different pubky. In Pubky Ring, choose the pubky 1aeh…dwdy, then try again. Nothing was recorded.",
        expect.objectContaining({ closeButton: true, duration: 10_000 }),
      ),
    );
    // No box in the card and no Try again: the blurred code is the way to a new request.
    expect(within(ringCard()).queryByRole("alert")).toBeNull();
    expect(within(ringCard()).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(onRingVerified).not.toHaveBeenCalled();
    await userEvent
      .setup()
      .click(within(ringCard()).getByRole("button", { name: "Reload sign-in QR code" }));
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(2));
    expect(
      await within(ringCard()).findByRole("img", { name: "Pubky Ring verification QR code" }),
    ).toBeVisible();
  });

  it("offers a new code in place of an expired one", async () => {
    const ring = verifier();
    ring.poll.mockResolvedValueOnce(Result.err({ code: "expired" }));
    mount({ ring });

    const reload = await within(ringCard()).findByRole("button", {
      name: "Reload sign-in QR code",
    });
    expect(within(ringCard()).getByText("Click to reload")).toBeVisible();
    expect(MOCKS.toastError).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^This verification request expired/u),
      expect.anything(),
    );
    await userEvent.setup().click(reload);
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(2));
  });

  it("on a phone, says a failure in a toast and offers Try again, as it shows no code", async () => {
    stubCoarsePointer();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign: vi.fn() });
    const ring = verifier();
    ring.poll.mockResolvedValueOnce(Result.err({ code: "connection_failed" }));
    mount({ ring });
    const user = userEvent.setup();

    await user.click(within(ringCard()).getByRole("button", { name: "Verify in Pubky Ring" }));
    await waitFor(() =>
      expect(MOCKS.toastError).toHaveBeenCalledExactlyOnceWith(
        expect.stringMatching(/^The check failed/u),
        expect.anything(),
      ),
    );
    expect(within(ringCard()).queryByText("Click to reload")).toBeNull();
    await user.click(within(ringCard()).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(2));
    expect(
      await within(ringCard()).findByRole("link", { name: /^Open(ing)? Pubky Ring/u }),
    ).toHaveAttribute("href", REQUEST);
  });

  it("on a phone, opens Pubky Ring from the card's one press, keeps that button, and can be cancelled", async () => {
    stubCoarsePointer();
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign });
    const { ring } = mount();
    const user = userEvent.setup();

    // Nothing is asked of Pubky Ring until the button is pressed.
    const start = within(ringCard()).getByRole("button", { name: "Verify in Pubky Ring" });
    expect(ring.start).not.toHaveBeenCalled();
    await user.click(start);
    expect(ring.start).toHaveBeenCalledExactlyOnceWith(KEY, "grant");
    // The press opens Pubky Ring as soon as the request exists, once, from the button that took
    // the pressed one's place, with Cancel beneath it and no waiting line.
    const link = await within(ringCard()).findByRole("link", { name: "Opening Pubky Ring…" });
    expect(link).toHaveAttribute("href", REQUEST);
    expect(assign).toHaveBeenCalledExactlyOnceWith(REQUEST);
    expect(within(ringCard()).queryByText(/Waiting for|Preparing your/u)).toBeNull();
    expect(within(ringCard()).queryByRole("img", { name: /QR code/u })).not.toBeInTheDocument();
    await user.click(within(ringCard()).getByRole("button", { name: "Cancel" }));
    expect(ring.dispose).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledOnce();
    expect(within(ringCard()).getByRole("button", { name: "Verify in Pubky Ring" })).toHaveFocus();
  });

  it("asks older Pubky Ring the classic way once its switch is on, and the new way once it is off", async () => {
    const { ring } = mount();
    const user = userEvent.setup();
    await within(ringCard()).findByRole("img", { name: "Pubky Ring verification QR code" });
    expect(ring.start).toHaveBeenCalledExactlyOnceWith(KEY, "grant");
    // Under the code, off until this device chose otherwise.
    const classic = within(ringCard()).getByRole("switch", {
      name: "Older Pubky Ring? Classic QR",
    });
    expect(classic).not.toBeChecked();
    expect(
      within(ringCard())
        .getByRole("img", { name: "Pubky Ring verification QR code" })
        .compareDocumentPosition(classic) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // On: the pending request is let go and the same check is asked again, the legacy way.
    await user.click(classic);
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(2));
    expect(ring.start).toHaveBeenLastCalledWith(KEY, "cookie");
    expect(ring.dispose).toHaveBeenCalledOnce();
    expect(classic).toBeChecked();
    expect(localStorage.getItem(KEYCHAIN_AUTH_METHOD_KEY)).toBe("cookie");
    expect(
      await within(ringCard()).findByRole("img", { name: "Pubky Ring verification QR code" }),
    ).toBeVisible();

    // Off again: back to the request Pubky Ring 2.0 and Bitkit approve.
    await user.click(classic);
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(3));
    expect(ring.start).toHaveBeenLastCalledWith(KEY, "grant");
    expect(localStorage.getItem(KEYCHAIN_AUTH_METHOD_KEY)).toBeNull();
  });

  it("asks the classic way from the start on a device that chose it", async () => {
    writeKeychainAuthMethod("cookie");
    const { ring } = mount();

    await within(ringCard()).findByRole("img", { name: "Pubky Ring verification QR code" });
    expect(ring.start).toHaveBeenCalledExactlyOnceWith(KEY, "cookie");
    expect(
      within(ringCard()).getByRole("switch", { name: "Older Pubky Ring? Classic QR" }),
    ).toBeChecked();
  });

  it("after the export, offers Skip for now, and a passing check leads on to the same place", async () => {
    const ring = verifier();
    let approve = () => undefined as void;
    ring.poll.mockImplementation(
      () =>
        new Promise((resolve) => {
          approve = () => resolve(Result.ok({ status: "verified", at: AT }));
        }),
    );
    const onDone = vi.fn();
    const { onBack } = mount({ ring, onDone, skippable: true });
    const user = userEvent.setup();

    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onDone).toHaveBeenCalledOnce();
    await waitFor(() => expect(ring.poll).toHaveBeenCalled());
    await act(async () => approve());
    expect(onDone).toHaveBeenCalledTimes(2);
    // Back still leads back, not on.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it("lets go of Pubky Ring's request when the page is left", async () => {
    const { ring, unmount, onBack } = mount();
    await within(ringCard()).findByRole("img", { name: "Pubky Ring verification QR code" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
    unmount();
    expect(ring.dispose).toHaveBeenCalled();
  });
});
