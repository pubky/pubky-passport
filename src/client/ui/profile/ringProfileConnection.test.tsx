/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type {
  RingConnectionErrorCode,
  RingConnectionProgress,
} from "@/client/logic/profile/RingProfileController";
import {
  KEYCHAIN_AUTH_METHOD_KEY,
  writeKeychainAuthMethod,
} from "@/client/logic/pubky/keychainAuthMethod";
import { RingProfileConnection } from "./ringProfileConnection";

const MOCKS = vi.hoisted(() => ({ toastError: vi.fn(), toastInfo: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: MOCKS.toastError, info: MOCKS.toastInfo } }));

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const IDENTITY: LocalIdentityMetadata = {
  publicIdentity: { publicKeyZ32: KEY },
  keySource: "ring",
};
/** The saved identity whose profile the connection is for, as the catalog shows it. */
const CAROL: LocalIdentityMetadata = { ...IDENTITY, profile: { name: "Carol" } };
const PROFILE_REQUEST = "pubkyauth://signin?secret=passport-profile-only";
const PHONE = (query: string) => ({
  matches: query === "(pointer: coarse)",
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
});
const QR_CODE = "Keychain connection QR code";
const CLASSIC = "Older Pubky Ring? Classic QR";

/** A failure is said once, in an error toast that stays until read or closed. */
async function expectFailureToast(message: string) {
  await waitFor(() =>
    expect(MOCKS.toastError).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(message),
      expect.objectContaining({ closeButton: true, duration: 10_000 }),
    ),
  );
}
type Failure = { code: RingConnectionErrorCode };
type PollResult = Result<RingConnectionProgress, Failure>;

function controller() {
  return {
    start: vi.fn(async (): Promise<Result<void, Failure>> => Result.ok()),
    poll: vi.fn(async (): Promise<PollResult> => Result.ok({ status: "waiting" })),
    confirm: vi.fn(async (): Promise<Result<LocalIdentityMetadata, Failure>> =>
      Result.ok(IDENTITY),
    ),
    authorizationUrl: () => PROFILE_REQUEST,
    isConnected: vi.fn(() => false),
    save: vi.fn(),
    dispose: vi.fn(),
  };
}
function mount(
  ring: ReturnType<typeof controller>,
  props: Partial<Parameters<typeof RingProfileConnection>[0]> = {
    identity: CAROL,
    setupRequired: true,
  },
) {
  const onComplete = vi.fn();
  const view = render(
    <RingProfileConnection controller={ring} onBack={vi.fn()} onComplete={onComplete} {...props} />,
  );
  return { onComplete, ...view };
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // A pointer one test stubs never leaks into the next, even when that test fails.
  vi.unstubAllGlobals();
  // Nor does the classic QR choice, which is kept for the device.
  writeKeychainAuthMethod("grant");
  localStorage.clear();
});

describe("RingProfileConnection", () => {
  it("shows the profile request under its own labels and completes once Ring approves", async () => {
    const ring = controller();
    ring.poll
      .mockResolvedValueOnce(Result.ok({ status: "waiting" }))
      .mockResolvedValueOnce(Result.ok({ status: "connected", identity: IDENTITY }));
    const { onComplete } = mount(ring);
    expect(await screen.findByRole("img", { name: QR_CODE })).toBeInTheDocument();
    // No line says Passport is waiting: the code is the whole hand-off.
    expect(screen.queryByText(/Waiting for/u)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    // Passport's own request must not pass for an app's sign-in request.
    const card = screen.getByRole("region", { name: "Keychain connection" });
    // Without a coarse pointer (a computer) the QR code shows at once, with no link to open.
    expect(within(card).getByRole("img", { name: QR_CODE })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open keychain app" })).toBeNull();
    expect(screen.queryByRole("img", { name: "Pubky authorization QR code" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Sign in with your keychain" })).toBeNull();
    // Beside the code, what to do in either keychain app, in order.
    expect(
      within(card)
        .getAllByRole("listitem")
        .map((step) => step.textContent),
    ).toEqual(["Open Pubky Ring or Bitkit", "Tap ‘Scan’", "Scan this QR", "Authorize in the app"]);
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(IDENTITY), { timeout: 3_000 });
    expect(ring.start).toHaveBeenCalledWith({
      expectedKey: KEY,
      setupRequired: true,
      confirmIdentity: false,
      method: "grant",
    });
  });

  it("offers a phone one button that opens the keychain app, and never a QR code", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(pointer: coarse)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const ring = controller();
    ring.poll.mockResolvedValue(Result.ok({ status: "waiting" }));
    mount(ring);

    expect(await screen.findByRole("link", { name: "Open keychain app" })).toHaveAttribute(
      "href",
      PROFILE_REQUEST,
    );
    expect(screen.queryByRole("img", { name: QR_CODE })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show QR code" })).toBeNull();
    expect(screen.queryByText(/Waiting for/u)).toBeNull();
    // Either app opens the link: both are named over the button, and no scanning steps are listed.
    const card = screen.getByRole("region", { name: "Keychain connection" });
    expect(within(card).getByRole("img", { name: "Pubky Ring" })).toBeInTheDocument();
    expect(within(card).getByRole("img", { name: "Bitkit" })).toBeInTheDocument();
    expect(within(card).queryByRole("list")).toBeNull();
    // A phone with older Pubky Ring needs the classic request too.
    expect(within(card).getByRole("switch", { name: CLASSIC })).not.toBeChecked();
  });

  it.each<[RingConnectionErrorCode, string]>([
    [
      "wrong_identity",
      "Your keychain approved a different identity. In your keychain app, choose Carol (1aeh…dwdy), then try again.",
    ],
    ["expired", "This connection request expired."],
    ["missing_capabilities", "Your keychain did not grant every permission"],
    [
      "connection_failed",
      "either at the relay while waiting for your keychain or at your homeserver after it approved. Try again and approve the new request in your keychain app.",
    ],
    [
      "homeserver_unresolved",
      "Your keychain approved, but Passport could not find your pubky's homeserver",
    ],
    ["grant_rejected", "Your keychain approved, but your homeserver did not accept the connection"],
    ["cancelled", "This connection request was closed."],
  ])(
    "explains %s in a toast and starts a new request from the spent code",
    async (code, message) => {
      const ring = controller();
      ring.poll.mockResolvedValueOnce(Result.err({ code }));
      mount(ring);
      await expectFailureToast(message);
      // No box under the code and no Try again: the spent code, blurred in place, is the retry.
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("Click to reload")).toBeVisible();
      expect(
        screen
          .getAllByRole("button")
          .map((button) => button.getAttribute("aria-label") ?? button.textContent),
      ).toEqual(["Copy Pubky", "Reload sign-in QR code", "Back"]);
      await userEvent.setup().click(screen.getByRole("button", { name: "Reload sign-in QR code" }));
      await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(2));
      expect(ring.dispose).toHaveBeenCalledOnce();
      // The pressed tile is gone once Ring waits again; focus moves to the new code, not the page.
      const newCode = await screen.findByRole("img", { name: QR_CODE });
      expect(newCode).toBeVisible();
      expect(document.activeElement).toContainElement(newCode);
      expect(screen.getByRole("region", { name: "Keychain connection" })).toContainElement(
        document.activeElement as HTMLElement,
      );
    },
  );

  it("on a phone, explains a failure in a toast and offers Try again, as it shows no code", async () => {
    vi.stubGlobal("matchMedia", PHONE);
    const ring = controller();
    ring.poll.mockResolvedValueOnce(Result.err({ code: "connection_failed" }));
    mount(ring);
    await expectFailureToast("The connection failed");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Click to reload")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("link", { name: "Open keychain app" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(document.activeElement).toContainElement(
      screen.getByRole("link", { name: "Open keychain app" }),
    );
  });

  it("starts a new request when the expired code itself is pressed", async () => {
    const ring = controller();
    ring.poll.mockResolvedValueOnce(Result.err({ code: "expired" }));
    mount(ring);

    const reload = await screen.findByRole("button", { name: "Reload sign-in QR code" });
    expect(screen.getByText("Click to reload")).toBeVisible();
    // The expired link is not drawn any more.
    expect(screen.queryByRole("img", { name: /QR code/u })).not.toBeInTheDocument();
    await userEvent.setup().click(reload);
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("img", { name: QR_CODE })).toBeVisible();
  });

  it("holds the code's place while the request is prepared, so nothing moves when it arrives", async () => {
    const ring = controller();
    let ready!: () => void;
    ring.start.mockImplementationOnce(
      () => new Promise((resolve) => (ready = () => resolve(Result.ok()))),
    );
    mount(ring);

    const section = screen.getByRole("region", { name: "Keychain connection" });
    expect(within(section).getByText("Generating QR code…")).toBeVisible();
    // The tile says it; no line under it comes and goes.
    expect(screen.queryByText(/Preparing your connection/u)).toBeNull();
    ready();
    expect(await screen.findByRole("img", { name: QR_CODE })).toBeVisible();
    expect(screen.queryByText("Generating QR code…")).not.toBeInTheDocument();
    expect(screen.queryByText(/Waiting for/u)).toBeNull();
  });

  it("explains a request that could not be created before polling", async () => {
    const ring = controller();
    ring.start.mockResolvedValueOnce(Result.err({ code: "request_failed" }));
    mount(ring);
    await expectFailureToast("Passport could not create a connection request.");
    expect(screen.getByRole("button", { name: "Reload sign-in QR code" })).toBeEnabled();
    expect(ring.poll).not.toHaveBeenCalled();
  });

  it("retries a storage failure with the approved grant instead of a new request", async () => {
    const ring = controller();
    ring.poll
      .mockResolvedValueOnce(Result.err({ code: "storage_failed" }))
      .mockResolvedValueOnce(Result.ok({ status: "connected", identity: IDENTITY }));
    const { onComplete } = mount(ring);
    await expectFailureToast("Free some storage");
    await userEvent.setup().click(screen.getByRole("button", { name: "Reload sign-in QR code" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(IDENTITY));
    expect(ring.start).toHaveBeenCalledOnce();
    expect(ring.dispose).not.toHaveBeenCalled();
  });

  it("closes an unapproved request when the screen is left", async () => {
    const ring = controller();
    const { unmount } = mount(ring);
    expect(await screen.findByRole("img", { name: QR_CODE })).toBeInTheDocument();
    unmount();
    expect(ring.dispose).toHaveBeenCalledOnce();
  });
});

describe("the classic QR switch, for Pubky Ring older than 2.0", () => {
  const REQUEST = { expectedKey: KEY, setupRequired: true, confirmIdentity: false };

  it("sits under the hand-off and asks again the classic way, then the new way, kept for the device", async () => {
    const ring = controller();
    mount(ring);
    const code = await screen.findByRole("img", { name: QR_CODE });
    expect(ring.start).toHaveBeenCalledExactlyOnceWith({ ...REQUEST, method: "grant" });
    // Part of the keychain card, after the code; off unless this device chose it.
    const classic = within(screen.getByRole("region", { name: "Keychain connection" })).getByRole(
      "switch",
      { name: CLASSIC },
    );
    expect(classic).not.toBeChecked();
    expect(code.compareDocumentPosition(classic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(localStorage.getItem(KEYCHAIN_AUTH_METHOD_KEY)).toBeNull();

    // On: the pending request is closed and the same one is asked again, the legacy way.
    const user = userEvent.setup();
    await user.click(classic);
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(2));
    expect(ring.start).toHaveBeenLastCalledWith({ ...REQUEST, method: "cookie" });
    expect(ring.dispose).toHaveBeenCalledOnce();
    expect(classic).toBeChecked();
    expect(localStorage.getItem(KEYCHAIN_AUTH_METHOD_KEY)).toBe("cookie");
    expect(await screen.findByRole("img", { name: QR_CODE })).toBeVisible();

    // Off: back to the request Pubky Ring 2.0 and Bitkit approve, and nothing stays stored.
    await user.click(classic);
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(3));
    expect(ring.start).toHaveBeenLastCalledWith({ ...REQUEST, method: "grant" });
    expect(ring.dispose).toHaveBeenCalledTimes(2);
    expect(classic).not.toBeChecked();
    expect(localStorage.getItem(KEYCHAIN_AUTH_METHOD_KEY)).toBeNull();
  });

  it("asks again the classic way from the start page's card", async () => {
    const ring = controller();
    mount(ring, { embedded: true, onBack: vi.fn() });
    await screen.findByRole("img", { name: QR_CODE });

    await userEvent.setup().click(screen.getByRole("switch", { name: CLASSIC }));
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(2));
    expect(ring.start).toHaveBeenLastCalledWith({
      expectedKey: undefined,
      setupRequired: false,
      confirmIdentity: false,
      method: "cookie",
    });
    expect(ring.dispose).toHaveBeenCalledOnce();
    expect(localStorage.getItem(KEYCHAIN_AUTH_METHOD_KEY)).toBe("cookie");
    expect(await screen.findByRole("img", { name: QR_CODE })).toBeVisible();
  });

  it("asks the classic way from the start on a device that chose it", async () => {
    writeKeychainAuthMethod("cookie");
    const ring = controller();
    mount(ring);

    await screen.findByRole("img", { name: QR_CODE });
    expect(ring.start).toHaveBeenCalledExactlyOnceWith({ ...REQUEST, method: "cookie" });
    expect(screen.getByRole("switch", { name: CLASSIC })).toBeChecked();
    expect(ring.dispose).not.toHaveBeenCalled();
  });

  it("asks afresh the classic way while a storage retry resumes the approved grant", async () => {
    const ring = controller();
    ring.poll
      .mockResolvedValueOnce(Result.err({ code: "storage_failed" }))
      // The resumed poll of the grant Ring already approved, still pending at the switch.
      .mockImplementationOnce(() => new Promise<PollResult>(() => undefined));
    mount(ring);
    await expectFailureToast("Free some storage");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reload sign-in QR code" }));
    await waitFor(() => expect(ring.poll).toHaveBeenCalledTimes(2));
    expect(ring.start).toHaveBeenCalledOnce();
    expect(ring.dispose).not.toHaveBeenCalled();

    // The approval being resumed belongs to the old request: it is closed and a new one is made,
    // never the old connection polled again.
    await user.click(screen.getByRole("switch", { name: CLASSIC }));
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(2));
    expect(ring.start).toHaveBeenLastCalledWith({ ...REQUEST, method: "cookie" });
    expect(ring.dispose).toHaveBeenCalledOnce();
    expect(ring.dispose.mock.invocationCallOrder[0]).toBeLessThan(
      ring.start.mock.invocationCallOrder[1]!,
    );
    expect(await screen.findByRole("img", { name: QR_CODE })).toBeVisible();
    // The new request's own poll follows its start.
    await waitFor(() => expect(ring.poll).toHaveBeenCalledTimes(3));
    expect(ring.poll.mock.invocationCallOrder[2]).toBeGreaterThan(
      ring.start.mock.invocationCallOrder[1]!,
    );
  });
});

describe("RingProfileConnection after a Ring signup", () => {
  const OTHER = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";

  it("shows the pubky Ring connected and saves it only after confirmation", async () => {
    const ring = controller();
    ring.poll.mockResolvedValueOnce(
      Result.ok({ status: "approved", publicKeyZ32: OTHER, hasProfile: "none" }),
    );
    const { onComplete } = mount(ring, { setupRequired: true, confirmIdentity: true });
    expect(
      screen.getByText(
        "Approve with the pubky you just created so Passport can publish its profile.",
      ),
    ).toBeInTheDocument();
    // The steps are the keychain's usual ones; the line above says which pubky to approve.
    expect(
      within(screen.getByRole("region", { name: "Keychain connection" }))
        .getAllByRole("listitem")
        .map((step) => step.textContent),
    ).toEqual(["Open Pubky Ring or Bitkit", "Tap ‘Scan’", "Scan this QR", "Authorize in the app"]);
    expect(
      await screen.findByRole("heading", { name: "Is this your new pubky?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(OTHER)).toBeInTheDocument();
    // The label names the key to compare with the one in Pubky Ring, not a connection status.
    expect(screen.getByText(OTHER).parentElement?.previousElementSibling).toHaveTextContent(
      "Pubky from your keychain",
    );
    expect(
      screen.getByText(/the pubky you just created in your keychain app\./u),
    ).toBeInTheDocument();
    expect(ring.start).toHaveBeenCalledWith({
      expectedKey: undefined,
      setupRequired: true,
      confirmIdentity: true,
      method: "grant",
    });
    expect(screen.queryByRole("link", { name: "Open keychain app" })).toBeNull();
    // The request is settled: there is nothing to ask the classic way while confirming.
    expect(screen.queryByRole("switch", { name: CLASSIC })).toBeNull();
    expect(ring.confirm).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole("button", { name: "Yes, it is my new pubky" }));
    expect(ring.confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(IDENTITY));
  });

  it("starts a new request when the connected pubky is not the new one", async () => {
    const ring = controller();
    ring.poll.mockResolvedValueOnce(
      Result.ok({ status: "approved", publicKeyZ32: OTHER, hasProfile: "none" }),
    );
    const { onComplete } = mount(ring, { setupRequired: true, confirmIdentity: true });
    await screen.findByText(OTHER);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "No, choose again in your keychain" }));
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(2));
    // The unconfirmed grant is closed; nothing was saved.
    expect(ring.dispose).toHaveBeenCalledOnce();
    expect(ring.confirm).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(await screen.findByRole("img", { name: QR_CODE })).toBeInTheDocument();
  });

  it("does not present a pubky that already has a profile as the new one", async () => {
    const ring = controller();
    ring.poll.mockResolvedValueOnce(
      Result.ok({ status: "approved", publicKeyZ32: OTHER, hasProfile: "published" }),
    );
    const { onComplete } = mount(ring, { setupRequired: true, confirmIdentity: true });
    expect(
      await screen.findByRole("heading", { name: "This pubky already has a profile" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes, it is my new pubky" })).toBeNull();
    expect(screen.queryByText(/publishes your new profile/u)).toBeNull();
    expect(screen.getByText(/Its profile stays as it is\./u)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add this pubky" }));
    expect(ring.confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(IDENTITY));
    // The pubky just created in Ring was not added, and the person is told so.
    expect(MOCKS.toastInfo).toHaveBeenCalledWith(`Added ${KEY.slice(0, 4)}…${KEY.slice(-4)}`, {
      description: expect.stringMatching(
        /^The pubky you just created in your keychain is not in Passport yet\. Add it from Sign in with your keychain\.$/u,
      ),
    });
  });

  it("treats a pubky whose profile could not be read as the new one", async () => {
    const ring = controller();
    ring.poll.mockResolvedValueOnce(
      Result.ok({ status: "approved", publicKeyZ32: OTHER, hasProfile: "unknown" }),
    );
    const { onComplete } = mount(ring, { setupRequired: true, confirmIdentity: true });
    expect(
      await screen.findByRole("heading", { name: "Is this your new pubky?" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/already has a public profile/u)).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Yes, it is my new pubky" }));
    expect(ring.confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(IDENTITY));
    expect(MOCKS.toastInfo).not.toHaveBeenCalled();
  });

  it("offers to choose again when Ring approved a pubky that already has a profile", async () => {
    const ring = controller();
    ring.poll.mockResolvedValueOnce(
      Result.ok({ status: "approved", publicKeyZ32: OTHER, hasProfile: "published" }),
    );
    mount(ring, { setupRequired: true, confirmIdentity: true });
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Choose again in your keychain" }));
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(2));
    expect(ring.confirm).not.toHaveBeenCalled();
  });

  it("keeps the confirmed pubky when saving it fails and retries without Ring", async () => {
    const ring = controller();
    ring.poll
      .mockResolvedValueOnce(
        Result.ok({ status: "approved", publicKeyZ32: OTHER, hasProfile: "none" }),
      )
      .mockResolvedValueOnce(Result.ok({ status: "connected", identity: IDENTITY }));
    ring.confirm.mockResolvedValueOnce(Result.err({ code: "storage_failed" }));
    const { onComplete } = mount(ring, { setupRequired: true, confirmIdentity: true });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Yes, it is my new pubky" }));
    await expectFailureToast("Free some storage");
    await user.click(screen.getByRole("button", { name: "Reload sign-in QR code" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(IDENTITY));
    expect(ring.start).toHaveBeenCalledOnce();
    expect(ring.dispose).not.toHaveBeenCalled();
  });
});

it("adds an existing Ring identity without asking for setup or a confirmation", async () => {
  const ring = controller();
  ring.poll.mockResolvedValueOnce(Result.ok({ status: "connected", identity: IDENTITY }));
  const { onComplete } = mount(ring, {});
  expect(
    screen.getByText(
      "Approve in your keychain to add your pubky. Passport changes nothing until you do.",
    ),
  ).toBeInTheDocument();
  await waitFor(() => expect(onComplete).toHaveBeenCalledWith(IDENTITY));
  expect(ring.start).toHaveBeenCalledWith({
    expectedKey: undefined,
    setupRequired: false,
    confirmIdentity: false,
    method: "grant",
  });
  expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
});

it("shows the identity to connect and Skip for now as a side action", async () => {
  const onDefer = vi.fn();
  mount(controller(), { identity: CAROL, setupRequired: true, onDefer });
  // The shared keychain hand-off, with no waiting line under the code.
  expect(await screen.findByRole("img", { name: QR_CODE })).toBeVisible();
  expect(screen.queryByText(/Waiting for/u)).toBeNull();
  expect(
    screen.getByRole("heading", { level: 1, name: "Connect your keychain." }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Approve in your keychain so Passport can edit your public profile."),
  ).toBeInTheDocument();

  // Named as the identity lists show it, then its full key to match in Pubky Ring: read-only,
  // like Manage identity, a labelled value with a copy button, not a grey line.
  const card = screen.getByRole("region", { name: "Identity to connect" });
  expect(card).toHaveTextContent("Carol");
  expect(card).toHaveTextContent("1aeh…dwdy");
  expect(card).toHaveTextContent(KEY);
  expect(screen.queryByText(`Pubky: ${KEY}`)).toBeNull();
  expect(screen.getByRole("button", { name: "Copy Pubky" })).toBeEnabled();
  const back = screen.getByRole("button", { name: "Back" });
  const finishLater = screen.getByRole("button", { name: "Skip for now" });
  expect(finishLater.closest('[data-slot="tertiary-actions"]')).not.toBeNull();
  expect(back.compareDocumentPosition(finishLater) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await userEvent.setup().click(finishLater);
  expect(onDefer).toHaveBeenCalledOnce();
});

it("says one short line, the same on a computer and a phone, as the card lists the steps", async () => {
  mount(controller());
  expect(
    await screen.findByText("Approve in your keychain so Passport can edit your public profile."),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Scan this code/u)).toBeNull();
  cleanup();

  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  mount(controller());
  expect(
    await screen.findByText("Approve in your keychain so Passport can edit your public profile."),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Scan this code/u)).toBeNull();
});

describe("reached from an app's sign-in", () => {
  it("says the person is signed in, that the app needs a profile, and what approving does", async () => {
    mount(controller(), {
      appSignIn: { requester: "notes.example" },
      identity: CAROL,
      setupRequired: true,
    });

    expect(screen.getByRole("heading", { level: 1, name: "Set up your profile." })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Connect your keychain." })).toBeNull();
    expect(
      screen.getByText(
        "You’re signed in, but notes.example needs a public profile. Approve in your keychain so Passport can create it.",
      ),
    ).toBeVisible();
    // Like every connection, it shows the code with no waiting line under it.
    expect(await screen.findByRole("img", { name: QR_CODE })).toBeVisible();
    expect(screen.queryByText(/Waiting for/u)).toBeNull();
  });

  it("says the same line on a phone, and says this app when nothing names it", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(pointer: coarse)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      mount(controller(), { appSignIn: { requester: undefined }, identity: IDENTITY });
      expect(
        screen.getByText(
          "You’re signed in, but this app needs a public profile. Approve in your keychain so Passport can create it.",
        ),
      ).toBeVisible();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the connection's own copy when Ring is connected from Passport's home", () => {
    mount(controller(), { identity: CAROL });

    expect(screen.getByRole("heading", { level: 1, name: "Connect your keychain." })).toBeVisible();
    expect(screen.queryByText(/You’re signed in/u)).toBeNull();
    expect(
      screen.getByText("Approve in your keychain so Passport can edit your public profile."),
    ).toBeVisible();
  });
});

describe("embedded in the start page's keychain card", () => {
  it("has no screen or heading of its own, and Cancel closes it", async () => {
    const ring = controller();
    const onBack = vi.fn();
    const { container } = mount(ring, { embedded: true, onBack });

    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByRole("main")).toBeNull();
    expect(
      screen.getByText(
        "Approve in your keychain to add your pubky. Passport changes nothing until you do.",
      ),
    ).toBeInTheDocument();
    const code = await screen.findByRole("img", { name: QR_CODE });
    expect(code).toBeVisible();
    // The card around it is the surface: the hand-off adds no card or region of its own inside it.
    expect(screen.queryByRole("region")).toBeNull();
    expect(container.querySelector(".bg-card")).toBeNull();
    expect(screen.queryByText(/Waiting for/u)).toBeNull();
    // The classic switch sits under the code.
    const classic = screen.getByRole("switch", { name: CLASSIC });
    expect(classic).not.toBeChecked();
    expect(code.compareDocumentPosition(classic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    // Cancel sits on the card's text edge under the code, not stretched across the card.
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel.parentElement).toHaveClass("items-start");
    expect(cancel).not.toHaveClass("w-full");
    await userEvent.setup().click(cancel);
    expect(onBack).toHaveBeenCalledOnce();
    expect(container).not.toBeEmptyDOMElement();
  });

  it("keeps the instruction for assistive technology and takes no focus when it starts with the page", async () => {
    const ring = controller();
    ring.poll.mockResolvedValueOnce(Result.err({ code: "connection_failed" }));
    mount(ring, { embedded: true, onBack: undefined });

    // The card's own line says what it is for; the full instruction is not shown.
    expect(
      screen.getByText(
        "Approve in your keychain to add your pubky. Passport changes nothing until you do.",
      ),
    ).toHaveClass("sr-only");
    // Nobody pressed anything: a failure is said in a toast, without moving focus, and the spent
    // code on the card's edge is the way to a new one.
    await expectFailureToast("The connection failed");
    expect(document.body).toHaveFocus();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByText("Click to reload").closest(".items-start")).not.toBeNull();
  });

  it("has nothing to cancel without a way to close it, where leaving the page ends the request", async () => {
    mount(controller(), { embedded: true, onBack: undefined });

    expect(await screen.findByRole("img", { name: QR_CODE })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});

describe("as a computer's whole keychain card on Sign in", () => {
  it("is one region named by its heading, with the lead, the code, the switch under it and the steps", async () => {
    const ring = controller();
    mount(ring, { embedded: "card", onBack: undefined });

    // No screen of its own: the card is the Sign in page's keychain card.
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByRole("main")).toBeNull();
    const card = screen.getByRole("region", { name: "Scan QR with keychain." });
    expect(screen.getAllByRole("region")).toEqual([card]);
    expect(
      within(card).getByRole("heading", { level: 2, name: "Scan QR with keychain." }),
    ).toBeVisible();
    expect(
      within(card).getByText("Use Pubky Ring or Bitkit and follow the instructions below."),
    ).toBeVisible();
    // The card's own lead says what it is for; the connection's line is not repeated.
    expect(screen.queryByText(/Passport changes nothing until you do/u)).toBeNull();

    const code = await within(card).findByRole("img", { name: QR_CODE });
    const classic = within(card).getByRole("switch", { name: CLASSIC });
    expect(classic).not.toBeChecked();
    // The switch sits right under the code, in the code's column, before the steps.
    const column = classic.closest("label")!.parentElement!;
    expect(column.contains(code)).toBe(true);
    const steps = within(card).getByRole("list");
    expect(column.contains(steps)).toBe(false);
    expect(code.compareDocumentPosition(classic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(classic.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((step) => step.textContent),
    ).toEqual(["Open Pubky Ring or Bitkit", "Tap ‘Scan’", "Scan this QR", "Authorize in the app"]);
    // Nothing to cancel: leaving the page ends the request.
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(ring.start).toHaveBeenCalledExactlyOnceWith({
      expectedKey: undefined,
      setupRequired: false,
      confirmIdentity: false,
      method: "grant",
    });
  });

  it("asks again the classic way from the card's switch", async () => {
    const ring = controller();
    mount(ring, { embedded: "card", onBack: undefined });
    await screen.findByRole("img", { name: QR_CODE });

    await userEvent.setup().click(screen.getByRole("switch", { name: CLASSIC }));
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(2));
    expect(ring.start).toHaveBeenLastCalledWith(expect.objectContaining({ method: "cookie" }));
    expect(ring.dispose).toHaveBeenCalledOnce();
    expect(await screen.findByRole("img", { name: QR_CODE })).toBeVisible();
  });
});

it("names a wrong identity without a published name by its short key", async () => {
  const ring = controller();
  ring.poll.mockResolvedValueOnce(Result.err({ code: "wrong_identity" }));
  mount(ring, { identity: IDENTITY });
  await expectFailureToast(
    "Your keychain approved a different identity. In your keychain app, choose the pubky 1aeh…dwdy, then try again.",
  );
  // Without a profile it is named after its key, as the identity lists name it.
  expect(screen.getByRole("region", { name: "Identity to connect" })).toHaveTextContent(
    "Pubky 1aeh…dwdy",
  );
});

it("asks before Back or Skip for now leaves profile edits waiting for the connection", async () => {
  const onBack = vi.fn();
  const onDefer = vi.fn();
  render(
    <RingProfileConnection
      controller={controller()}
      identity={CAROL}
      setupRequired
      unsavedEdits
      onBack={onBack}
      onComplete={vi.fn()}
      onDefer={onDefer}
    />,
  );
  const user = userEvent.setup();
  // The screen says the edits wait here.
  expect(
    await screen.findByText("Your unsaved profile changes are kept until you leave."),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Back" }));
  const dialog = screen.getByRole("dialog", { name: "Discard your changes?" });
  expect(onBack).not.toHaveBeenCalled();
  // Keep editing comes first: the connection stays, and so do the edits.
  expect(within(dialog).getByRole("button", { name: "Keep editing" })).toHaveFocus();
  await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onBack).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Skip for now" }));
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(onDefer).toHaveBeenCalledOnce();
  expect(onBack).not.toHaveBeenCalled();
});

it("leaves at once when no profile edits wait for the connection", async () => {
  const onBack = vi.fn();
  render(
    <RingProfileConnection
      controller={controller()}
      identity={CAROL}
      onBack={onBack}
      onComplete={vi.fn()}
    />,
  );
  await screen.findByRole("img", { name: QR_CODE });
  expect(screen.queryByText(/Your unsaved profile changes/u)).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
  expect(onBack).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
});
