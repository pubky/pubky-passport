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
});

describe("RingProfileConnection", () => {
  it("shows the profile request under its own labels and completes once Ring approves", async () => {
    const ring = controller();
    ring.poll
      .mockResolvedValueOnce(Result.ok({ status: "waiting" }))
      .mockResolvedValueOnce(Result.ok({ status: "connected", identity: IDENTITY }));
    const { onComplete } = mount(ring);
    expect(
      await screen.findByRole("img", { name: "Pubky Ring profile connection QR code" }),
    ).toBeInTheDocument();
    // No line says Passport is waiting: the code is the whole hand-off.
    expect(screen.queryByText(/Waiting for/u)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
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

  it("offers a phone one button that opens Pubky Ring, and never a QR code", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(pointer: coarse)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const ring = controller();
    ring.poll.mockResolvedValue(Result.ok({ status: "waiting" }));
    mount(ring);

    expect(await screen.findByRole("link", { name: "Open Pubky Ring" })).toHaveAttribute(
      "href",
      PROFILE_REQUEST,
    );
    expect(screen.queryByRole("img", { name: "Pubky Ring profile connection QR code" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show QR code" })).toBeNull();
    expect(screen.queryByText(/Waiting for/u)).toBeNull();
  });

  it.each<[RingConnectionErrorCode, string]>([
    [
      "wrong_identity",
      "Pubky Ring approved a different identity. In Pubky Ring, choose Carol (1aeh…dwdy), then try again.",
    ],
    ["expired", "This connection request expired."],
    ["missing_capabilities", "Pubky Ring did not grant every permission"],
    [
      "connection_failed",
      "either at the relay while waiting for Pubky Ring or at your homeserver after Pubky Ring approved. Try again and approve the new request in Pubky Ring.",
    ],
    [
      "homeserver_unresolved",
      "Pubky Ring approved, but Passport could not find your pubky's homeserver",
    ],
    ["grant_rejected", "Pubky Ring approved, but your homeserver did not accept the connection"],
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
      expect(
        await screen.findByRole("img", { name: "Pubky Ring profile connection QR code" }),
      ).toBeVisible();
      expect(document.activeElement).toContainElement(
        screen.getByRole("region", { name: "Pubky Ring profile connection" }),
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
    expect(await screen.findByRole("link", { name: "Open Pubky Ring" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(document.activeElement).toContainElement(
      screen.getByRole("link", { name: "Open Pubky Ring" }),
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
    expect(
      await screen.findByRole("img", { name: "Pubky Ring profile connection QR code" }),
    ).toBeVisible();
  });

  it("holds the code's place while the request is prepared, so nothing moves when it arrives", async () => {
    const ring = controller();
    let ready!: () => void;
    ring.start.mockImplementationOnce(
      () => new Promise((resolve) => (ready = () => resolve(Result.ok()))),
    );
    mount(ring);

    const section = screen.getByRole("region", { name: "Pubky Ring profile connection" });
    expect(within(section).getByText("Generating QR code…")).toBeVisible();
    // The tile says it; no line under it comes and goes.
    expect(screen.queryByText(/Preparing your connection/u)).toBeNull();
    ready();
    expect(
      await screen.findByRole("img", { name: "Pubky Ring profile connection QR code" }),
    ).toBeVisible();
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
    expect(
      await screen.findByRole("img", { name: "Pubky Ring profile connection QR code" }),
    ).toBeInTheDocument();
    unmount();
    expect(ring.dispose).toHaveBeenCalledOnce();
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
    expect(screen.getByText(/choose the pubky you just created/u)).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Is this your new pubky?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(OTHER)).toBeInTheDocument();
    // The label names the key to compare with the one in Pubky Ring, not a connection status.
    expect(screen.getByText(OTHER).parentElement?.previousElementSibling).toHaveTextContent(
      "Pubky from Pubky Ring",
    );
    expect(screen.getByText(/the pubky you just created in Pubky Ring\./u)).toBeInTheDocument();
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
      .click(screen.getByRole("button", { name: "No, choose again in Pubky Ring" }));
    await waitFor(() => expect(ring.start).toHaveBeenCalledTimes(2));
    // The unconfirmed grant is closed; nothing was saved.
    expect(ring.dispose).toHaveBeenCalledOnce();
    expect(ring.confirm).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("img", { name: "Pubky Ring profile connection QR code" }),
    ).toBeInTheDocument();
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
        /^The pubky you just created in Pubky Ring is not in Passport yet\. Add it with Sign in with Pubky Ring\.$/u,
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
      .click(await screen.findByRole("button", { name: "Choose again in Pubky Ring" }));
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
  expect(screen.getByText(/add your pubky to Passport/u)).toBeInTheDocument();
  expect(screen.getByText(/changes nothing until you do/u)).toBeInTheDocument();
  await waitFor(() => expect(onComplete).toHaveBeenCalledWith(IDENTITY));
  expect(ring.start).toHaveBeenCalledWith({
    expectedKey: undefined,
    setupRequired: false,
    confirmIdentity: false,
  });
  expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
});

it("shows the identity to connect and Skip for now as a side action", async () => {
  const onDefer = vi.fn();
  mount(controller(), { identity: CAROL, setupRequired: true, onDefer });
  // The shared Ring hand-off, with no waiting line under the code.
  expect(
    await screen.findByRole("img", { name: "Pubky Ring profile connection QR code" }),
  ).toBeVisible();
  expect(screen.queryByText(/Waiting for/u)).toBeNull();
  expect(
    screen.getByRole("heading", { level: 1, name: "Connect Pubky Ring." }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Your private key stays in Pubky Ring\./u)).toBeInTheDocument();
  expect(screen.getByText("Don't have Pubky Ring?")).toBeInTheDocument();

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

it("asks a computer to scan the code, and a phone to approve in Pubky Ring", async () => {
  mount(controller());
  expect(
    await screen.findByText(
      "Scan this code with Pubky Ring on your phone, then approve so Passport can edit your public profile and avatar. Your private key stays in Pubky Ring.",
    ),
  ).toBeInTheDocument();
  cleanup();

  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  mount(controller());
  expect(
    await screen.findByText(
      "Approve in Pubky Ring so Passport can edit your public profile and avatar. Your private key stays in Pubky Ring.",
    ),
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
    expect(screen.queryByRole("heading", { name: "Connect Pubky Ring." })).toBeNull();
    // A computer scans the code; the rest of the sentence is the same.
    expect(
      screen.getByText(
        "You’re signed in with Pubky Ring, but notes.example needs a public profile. Scan this code with Pubky Ring on your phone and approve, so Passport can create it for you. Passport can only edit your profile and avatar; your private key stays in Pubky Ring.",
      ),
    ).toBeVisible();
    // Like every connection, it shows the code with no waiting line under it.
    expect(
      await screen.findByRole("img", { name: "Pubky Ring profile connection QR code" }),
    ).toBeVisible();
    expect(screen.queryByText(/Waiting for/u)).toBeNull();
  });

  it("asks a phone to approve in Pubky Ring, and says this app when nothing names it", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(pointer: coarse)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      mount(controller(), { appSignIn: { requester: undefined }, identity: IDENTITY });
      expect(
        screen.getByText(
          "You’re signed in with Pubky Ring, but this app needs a public profile. Approve in Pubky Ring so Passport can create it for you. Passport can only edit your profile and avatar; your private key stays in Pubky Ring.",
        ),
      ).toBeVisible();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the connection's own copy when Ring is connected from Passport's home", () => {
    mount(controller(), { identity: CAROL });

    expect(screen.getByRole("heading", { level: 1, name: "Connect Pubky Ring." })).toBeVisible();
    expect(screen.queryByText(/You’re signed in with Pubky Ring/u)).toBeNull();
    expect(screen.getByText(/so Passport can edit your public profile and avatar/u)).toBeVisible();
  });
});

describe("embedded in the start page's Pubky Ring card", () => {
  it("has no screen or heading of its own, and Cancel closes it", async () => {
    const ring = controller();
    const onBack = vi.fn();
    const { container } = mount(ring, { embedded: true, onBack });

    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByRole("main")).toBeNull();
    expect(screen.getByText(/approve to add your pubky to Passport/u)).toBeVisible();
    expect(
      await screen.findByRole("img", { name: "Pubky Ring profile connection QR code" }),
    ).toBeVisible();
    // The card around it is the surface: the hand-off adds no second one inside it.
    expect(screen.getByRole("region", { name: "Pubky Ring profile connection" })).not.toHaveClass(
      "bg-card",
    );
    expect(screen.queryByText(/Waiting for/u)).toBeNull();
    expect(screen.getByText("Don't have Pubky Ring?")).toBeVisible();
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
    expect(screen.getByText(/approve to add your pubky to Passport/u)).toHaveClass("sr-only");
    // The badges alone, in one row on the card's text edge, under the question a screen reader
    // still hears.
    const install = document.querySelector('[data-slot="ring-install"]')!;
    expect(install).toHaveClass("items-start");
    expect(install.querySelector("p")).toHaveClass("sr-only");
    // Nobody pressed anything: a failure is said in a toast, without moving focus, and the spent
    // code on the card's edge is the way to a new one.
    await expectFailureToast("The connection failed");
    expect(document.body).toHaveFocus();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByText("Click to reload").closest(".items-start")).not.toBeNull();
  });

  it("has nothing to cancel on a computer's card, where leaving the page ends the request", async () => {
    mount(controller(), { embedded: true, onBack: undefined });

    expect(
      await screen.findByRole("img", { name: "Pubky Ring profile connection QR code" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});

it("names a wrong identity without a published name by its short key", async () => {
  const ring = controller();
  ring.poll.mockResolvedValueOnce(Result.err({ code: "wrong_identity" }));
  mount(ring, { identity: IDENTITY });
  await expectFailureToast(
    "Pubky Ring approved a different identity. In Pubky Ring, choose the pubky 1aeh…dwdy, then try again.",
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
  await screen.findByRole("img", { name: "Pubky Ring profile connection QR code" });
  expect(screen.queryByText(/Your unsaved profile changes/u)).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
  expect(onBack).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
});
