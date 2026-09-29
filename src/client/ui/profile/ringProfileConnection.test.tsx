/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import type {
  RingConnectionErrorCode,
  RingConnectionProgress,
} from "@/client/logic/profile/RingProfileController";
import { RingProfileConnection } from "./ringProfileConnection";

const KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const IDENTITY: LocalIdentityMetadata = {
  publicIdentity: { publicKeyZ32: KEY },
  keySource: "ring",
};
const PROFILE_REQUEST = "pubkyauth://signin?secret=passport-profile-only";
type Failure = { code: RingConnectionErrorCode };
type PollResult = Result<RingConnectionProgress, Failure>;

function controller() {
  return {
    start: vi.fn(async (): Promise<Result<void, Failure>> => Result.ok()),
    poll: vi.fn(async (): Promise<PollResult> => Result.ok({ status: "waiting" })),
    confirm: vi.fn((): Result<LocalIdentityMetadata, Failure> => Result.ok(IDENTITY)),
    authorizationUrl: () => PROFILE_REQUEST,
    isConnected: vi.fn(() => false),
    save: vi.fn(),
    dispose: vi.fn(),
  };
}
function mount(
  ring: ReturnType<typeof controller>,
  props: Partial<Parameters<typeof RingProfileConnection>[0]> = {
    expectedKey: KEY,
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
});

describe("RingProfileConnection", () => {
  it("shows the profile request under its own labels and completes once Ring approves", async () => {
    const ring = controller();
    ring.poll
      .mockResolvedValueOnce(Result.ok({ status: "waiting" }))
      .mockResolvedValueOnce(Result.ok({ status: "connected", identity: IDENTITY }));
    const { onComplete } = mount(ring);
    expect(await screen.findByText("Waiting for approval in Ring…")).toBeInTheDocument();
    // Passport's own request must not pass for an app's sign-in request.
    expect(
      screen.getByRole("region", { name: "Pubky Ring profile connection" }),
    ).toBeInTheDocument();
    // Without a coarse pointer (a computer) the QR code shows at once, with no link to open.
    expect(
      screen.getByRole("img", { name: "Pubky Ring profile connection QR code" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect in Pubky Ring" })).toBeNull();
    expect(screen.queryByRole("img", { name: "Pubky authorization QR code" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Sign in with Pubky Ring" })).toBeNull();
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(IDENTITY), { timeout: 3_000 });
    expect(ring.start).toHaveBeenCalledWith({
      expectedKey: KEY,
      setupRequired: true,
      confirmIdentity: false,
    });
  });

  it("offers the connection link on a phone and keeps its QR code behind a toggle", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(pointer: coarse)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const ring = controller();
    ring.poll.mockResolvedValue(Result.ok({ status: "waiting" }));
    mount(ring);

    expect(await screen.findByRole("link", { name: "Connect in Pubky Ring" })).toHaveAttribute(
      "href",
      PROFILE_REQUEST,
    );
    expect(screen.queryByRole("img", { name: "Pubky Ring profile connection QR code" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR code" }));
    expect(
      screen.getByRole("img", { name: "Pubky Ring profile connection QR code" }),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it.each<[RingConnectionErrorCode, string]>([
    ["wrong_identity", "Choose the same identity in Ring"],
    ["expired", "This connection request expired."],
    ["missing_capabilities", "did not grant every permission"],
    [
      "connection_failed",
      "either at the relay while waiting for Ring or at your homeserver after Ring approved",
    ],
    ["homeserver_unresolved", "Ring approved, but Passport could not find your pubky's homeserver"],
    ["grant_rejected", "Ring approved, but your homeserver did not accept the connection"],
    ["cancelled", "This connection request was closed."],
  ])("explains %s and starts a new request on Try again", async (code, message) => {
    const ring = controller();
    ring.poll.mockResolvedValueOnce(Result.err({ code }));
    mount(ring);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(alert).not.toHaveTextContent("Could not connect to Ring");
    // The failure takes focus, and the recovery is the primary action beside Back.
    expect(alert).toHaveFocus();
    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label") ?? button.textContent),
    ).toEqual(["Copy Pubky", "Back", "Try again"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(2));
    expect(ring.dispose).toHaveBeenCalledOnce();
    // Try again is gone once Ring waits again; focus moves to the wait, not the page.
    expect(await screen.findByText("Waiting for approval in Ring…")).toHaveFocus();
  });

  it("explains a request that could not be created before polling", async () => {
    const ring = controller();
    ring.start.mockResolvedValueOnce(Result.err({ code: "request_failed" }));
    mount(ring);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Passport could not create a connection request.",
    );
    expect(ring.poll).not.toHaveBeenCalled();
  });

  it("retries a storage failure with the approved grant instead of a new request", async () => {
    const ring = controller();
    ring.poll
      .mockResolvedValueOnce(Result.err({ code: "storage_failed" }))
      .mockResolvedValueOnce(Result.ok({ status: "connected", identity: IDENTITY }));
    const { onComplete } = mount(ring);
    expect(await screen.findByRole("alert")).toHaveTextContent("Free some storage");
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(IDENTITY));
    expect(ring.start).toHaveBeenCalledOnce();
    expect(ring.dispose).not.toHaveBeenCalled();
  });

  it("closes an unapproved request when the screen is left", async () => {
    const ring = controller();
    const { unmount } = mount(ring);
    expect(await screen.findByText("Waiting for approval in Ring…")).toBeInTheDocument();
    unmount();
    expect(ring.dispose).toHaveBeenCalledOnce();
  });
});

describe("RingProfileConnection after a Ring signup", () => {
  const OTHER = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";

  it("shows the pubky Ring connected and saves it only after confirmation", async () => {
    const ring = controller();
    ring.poll.mockResolvedValueOnce(Result.ok({ status: "approved", publicKeyZ32: OTHER }));
    const { onComplete } = mount(ring, { setupRequired: true, confirmIdentity: true });
    expect(screen.getByText(/choose the pubky you just created/u)).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Is this your new pubky?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(OTHER)).toBeInTheDocument();
    // The label names the key to compare with the one in Ring, not a connection status.
    expect(screen.getByText(OTHER).parentElement?.previousElementSibling).toHaveTextContent(
      "Pubky from Ring",
    );
    expect(ring.start).toHaveBeenCalledWith({
      expectedKey: undefined,
      setupRequired: true,
      confirmIdentity: true,
    });
    expect(screen.queryByRole("link", { name: "Connect in Pubky Ring" })).toBeNull();
    expect(ring.confirm).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole("button", { name: "Yes, it is my new pubky" }));
    expect(ring.confirm).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith(IDENTITY);
  });

  it("starts a new request when the connected pubky is not the new one", async () => {
    const ring = controller();
    ring.poll.mockResolvedValueOnce(Result.ok({ status: "approved", publicKeyZ32: OTHER }));
    const { onComplete } = mount(ring, { setupRequired: true, confirmIdentity: true });
    await screen.findByText(OTHER);
    await userEvent.setup().click(screen.getByRole("button", { name: "No, choose again in Ring" }));
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(2));
    // The unconfirmed grant is closed; nothing was saved.
    expect(ring.dispose).toHaveBeenCalledOnce();
    expect(ring.confirm).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(await screen.findByText("Waiting for approval in Ring…")).toBeInTheDocument();
  });

  it("keeps the confirmed pubky when saving it fails and retries without Ring", async () => {
    const ring = controller();
    ring.poll
      .mockResolvedValueOnce(Result.ok({ status: "approved", publicKeyZ32: OTHER }))
      .mockResolvedValueOnce(Result.ok({ status: "connected", identity: IDENTITY }));
    ring.confirm.mockReturnValueOnce(Result.err({ code: "storage_failed" }));
    const { onComplete } = mount(ring, { setupRequired: true, confirmIdentity: true });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Yes, it is my new pubky" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Free some storage");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(IDENTITY));
    expect(ring.start).toHaveBeenCalledOnce();
    expect(ring.dispose).not.toHaveBeenCalled();
  });
});

it("adds an existing Ring identity without asking for setup or a confirmation", async () => {
  const ring = controller();
  ring.poll.mockResolvedValueOnce(Result.ok({ status: "connected", identity: IDENTITY }));
  const { onComplete } = mount(ring, {});
  expect(screen.getByText(/add your pubky to Passport/u)).toBeInTheDocument();
  expect(screen.getByText(/changes nothing until you do/u)).toBeInTheDocument();
  await waitFor(() => expect(onComplete).toHaveBeenCalledWith(IDENTITY));
  expect(ring.start).toHaveBeenCalledWith({
    expectedKey: undefined,
    setupRequired: false,
    confirmIdentity: false,
  });
  expect(screen.queryByRole("button", { name: "Finish later" })).toBeNull();
});

it("shows the pubky to connect as a detail and Finish later as a side action", async () => {
  const onDefer = vi.fn();
  mount(controller(), { expectedKey: KEY, setupRequired: true, onDefer });
  expect(await screen.findByText("Waiting for approval in Ring…")).toBeInTheDocument();

  // Read-only, like Manage identity: a labelled value with a copy button, not a grey line.
  expect(screen.getByText(KEY)).toBeInTheDocument();
  expect(screen.queryByText(`Pubky: ${KEY}`)).toBeNull();
  expect(screen.getByRole("button", { name: "Copy Pubky" })).toBeEnabled();
  const back = screen.getByRole("button", { name: "Back" });
  const finishLater = screen.getByRole("button", { name: "Finish later" });
  expect(finishLater.closest('[data-slot="tertiary-actions"]')).not.toBeNull();
  expect(back.compareDocumentPosition(finishLater) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await userEvent.setup().click(finishLater);
  expect(onDefer).toHaveBeenCalledOnce();
});
