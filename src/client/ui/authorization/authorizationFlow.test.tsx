/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { bindTestOpener, releaseTestOpener } from "@test-utils/boundOpener";
import { fakePassportAuthorizationController } from "@test-utils/fakePassportAuthorizationController";
import { AuthorizationFlow, type AuthorizationRequestState } from "./authorizationFlow";

const REVIEW = {
  authenticationMethod: "cookie",
  capabilities: [{ path: "/pub/requesting.app/", read: true, write: true, scope: "specific" }],
  callbackHost: "requesting.app",
} as const;
const NAMED = { ...REVIEW, requesterName: "Acme Notes" } as const;
/** A request whose only name is its own label: it has no callbacks, so no website. */
const UNHOSTED = {
  authenticationMethod: "cookie",
  capabilities: REVIEW.capabilities,
  requesterName: "Acme Notes",
} as const;
const LOCAL: LocalIdentityMetadata = { publicIdentity: { publicKeyZ32: "local-key" } };

function renderFlow(
  authorization: AuthorizationRequestState,
  identity: LocalIdentityMetadata | undefined = LOCAL,
) {
  const approve = vi.fn();
  const cancel = vi.fn();
  const onSwitch = vi.fn();
  render(
    <AuthorizationFlow
      authorization={authorization}
      controller={fakePassportAuthorizationController(
        { current: authorization },
        { approve, cancel },
      )}
      identity={identity}
      onSwitch={onSwitch}
    />,
  );
  return { approve, cancel, onSwitch };
}

/**
 * A request a v2 hello bound, from the origin it returns to; `window.opener` is then reset, so each
 * test says itself whether this page is the app's popup.
 */
function bindRequestingApp() {
  bindTestOpener("https://requesting.app");
  vi.stubGlobal("opener", null);
}

describe("AuthorizationFlow", () => {
  beforeEach(bindRequestingApp);
  afterEach(() => {
    cleanup();
    releaseTestOpener();
  });

  it("approves with a local identity", async () => {
    const { approve } = renderFlow({ status: "review", review: REVIEW });

    await userEvent.setup().click(screen.getByRole("button", { name: "Authorize" }));

    expect(approve).toHaveBeenCalledWith("local-key");
  });

  it("keeps the review to Authorize and Cancel", () => {
    renderFlow({ status: "review", review: REVIEW });

    expect(screen.getByRole("button", { name: "Authorize" })).toBeEnabled();
    // Pubky Ring is one of the choices in the identity list, not a competing action here.
    expect(screen.queryByRole("button", { name: /Pubky Ring/u })).not.toBeInTheDocument();
  });

  it("cancels and switches from review", async () => {
    const user = userEvent.setup();
    const { cancel, onSwitch } = renderFlow({ status: "review", review: REVIEW });

    await user.click(screen.getByRole("button", { name: "Switch identity" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSwitch).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("shows the approval's progress on Authorize, never on Cancel", () => {
    renderFlow({ status: "granting", review: REVIEW });

    // The pressed button shows the work and keeps focus, so it is busy rather than disabled.
    const authorize = screen.getByRole("button", { name: "Signing in…" });
    expect(authorize).toHaveAttribute("aria-busy", "true");
    expect(authorize).toHaveAttribute("aria-disabled", "true");
    expect(authorize).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Switch identity" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sending your approval to requesting.app. This can't be undone now.",
    );
  });

  it("never shows a refusal as an approval while it goes back to the app", () => {
    renderFlow({ status: "completing", review: REVIEW, outcome: "cancel" });

    const cancel = screen.getByRole("button", { name: "Cancelling…" });
    expect(cancel).toHaveAttribute("aria-busy", "true");
    const authorize = screen.getByRole("button", { name: "Authorize" });
    expect(authorize).toBeDisabled();
    expect(authorize).not.toHaveAttribute("aria-busy");
    expect(screen.queryByText(/Returning|Completing/u)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Telling requesting.app you cancelled…");
  });

  it("says an approval goes back to the app, and a failure that it did not work", () => {
    renderFlow({ status: "completing", review: REVIEW, outcome: "success" });
    expect(screen.getByRole("button", { name: "Returning to the app…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Returning to requesting.app…");
    cleanup();

    renderFlow({ status: "completing", review: REVIEW, outcome: "error" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "The sign-in didn't work. Returning to requesting.app…",
    );
  });

  it.each([
    [{ status: "invalid" }, "Invalid sign-in link.", "This link can't be used to sign in."],
    [{ status: "expired" }, "Request expired.", "This sign-in request took too long to open."],
  ] as const)("explains a %o request without a review", (authorization, heading, cause) => {
    renderFlow(authorization);

    expect(screen.getByRole("heading", { name: heading })).toHaveAccessibleDescription(
      new RegExp(`^${cause}`, "u"),
    );
    // In a tab of its own there is no app window to close: the way out says where it goes.
    expect(screen.getByRole("button", { name: "Go to Passport" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();
  });

  it.each([
    [{ status: "approved", review: NAMED }, "Signed in to Acme Notes"],
    [{ status: "cancelled", review: NAMED }, "Sign-in cancelled."],
    [{ status: "failed", review: NAMED, reason: "delivery" }, "Couldn't reach Acme Notes"],
    [{ status: "failed", review: NAMED, reason: "identity" }, "Couldn't use Pubky local-key."],
  ] as const)("names the app on the %o outcome", (authorization, heading) => {
    renderFlow(authorization);

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Passport" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();
  });
});

describe("AuthorizationFlow outcomes", () => {
  beforeEach(bindRequestingApp);
  afterEach(() => {
    cleanup();
    releaseTestOpener();
    Object.defineProperty(window, "opener", { configurable: true, value: null });
    Object.defineProperty(window, "closed", { configurable: true, value: false });
    vi.restoreAllMocks();
  });

  it("says who signed in where after an approval", () => {
    renderFlow({ status: "approved", review: NAMED }, { ...LOCAL, profile: { name: "Satoshi" } });

    expect(
      screen.getByText(
        "Passport sent your approval as Satoshi. You can go back to Acme Notes now.",
      ),
    ).toBeInTheDocument();
  });

  it("blames the delivery, not the identity, when the approval did not reach the app", () => {
    renderFlow({ status: "failed", review: NAMED, reason: "delivery" });

    expect(screen.getByText("Your approval didn't reach Acme Notes.")).toBeInTheDocument();
    expect(screen.getByText("Go back to Acme Notes and start signing in again.")).toBeVisible();
    expect(screen.queryByText(/identity/u)).toBeNull();
  });

  it("names the identity whose key could not be unlocked, and points to its recovery file", () => {
    renderFlow(
      { status: "failed", review: NAMED, reason: "identity" },
      { ...LOCAL, profile: { name: "Satoshi" } },
    );

    expect(screen.getByRole("heading", { name: "Couldn't use Satoshi." })).toBeInTheDocument();
    expect(
      screen.getByText("Passport couldn't unlock the key of Satoshi in this browser."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/with another identity, or restore this one from its recovery file\.$/u),
    ).toBeVisible();
  });

  it("keeps a name made from a key in one piece in running text", () => {
    const key = "tkrq8zmwb8a3m9k15csu3q17qmfgqnp9dskbrg9uq1rydpyxp7qy";
    renderFlow(
      { status: "failed", review: NAMED, reason: "identity" },
      { publicIdentity: { publicKeyZ32: key } },
    );

    // It never breaks at the ellipsis of its short key.
    // (The heading shows it too, fitted to the column.)
    const [, inText] = screen.getAllByText("Pubky tkrq…p7qy");
    expect(inText).toHaveClass("whitespace-nowrap");
    expect(inText!.closest("p")).toHaveTextContent(
      "Passport couldn't unlock the key of Pubky tkrq…p7qy in this browser.",
    );
  });

  it("restores an identity with a Google account through Continue with Google", () => {
    renderFlow(
      { status: "failed", review: NAMED, reason: "identity" },
      {
        ...LOCAL,
        googleAccount: {
          googleSubject: "google-1",
          name: "Alex",
          email: "alex@example.com",
          pictureUrl: null,
        },
      },
    );

    expect(
      screen.getByText(
        /or restore this one with Continue with Google on Passport's start page\.$/u,
      ),
    ).toBeVisible();
    expect(screen.queryByText(/recovery file/u)).toBeNull();
  });

  it("names the app in the window title only beside its callback host", () => {
    renderFlow({ status: "approved", review: NAMED });
    expect(document.title).toBe("Signed in to Acme Notes (requesting.app) | Pubky Passport");
    cleanup();

    renderFlow({ status: "failed", review: REVIEW, reason: "delivery" });
    expect(screen.getByRole("heading", { name: "Couldn't reach requesting.app" })).toBeVisible();
    expect(document.title).toBe("Couldn't reach requesting.app | Pubky Passport");
  });

  it.each([
    [
      { status: "approved" },
      "Sign-in approved.",
      "Passport sent your approval as Pubky local-key. You can go back to the app now.",
    ],
    [{ status: "cancelled" }, "Sign-in cancelled.", "Nothing was shared."],
    [
      { status: "failed", reason: "delivery" },
      "Couldn't reach the app.",
      "Your approval didn't reach the app.",
    ],
  ] as const)(
    "never names a request without a website after its own label on the %o outcome",
    (outcome, heading, lead) => {
      // The label is the app's own choice, and nothing on screen would say which website sent it.
      renderFlow({ ...outcome, review: UNHOSTED } as AuthorizationRequestState);

      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
      expect(screen.getByRole("main")).toHaveTextContent(lead);
      expect(screen.queryByText(/Acme Notes/u)).toBeNull();
      expect(document.title).toBe(`${heading.replace(/\.$/u, "")} | Pubky Passport`);
    },
  );

  it("closes the app's popup instead of loading Passport's start page in it", async () => {
    Object.defineProperty(window, "opener", { configurable: true, value: { closed: false } });
    const close = vi.spyOn(window, "close").mockImplementation(() => {
      Object.defineProperty(window, "closed", { configurable: true, value: true });
    });
    renderFlow({ status: "cancelled", review: NAMED });

    expect(screen.queryByRole("button", { name: "Go to Passport" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Close window" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(["invalid", "expired"] as const)(
    "sends a %s request in a tab back to the app that sent it, not into onboarding",
    async (status) => {
      vi.spyOn(window.history, "length", "get").mockReturnValue(2);
      const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
      renderFlow({ status });

      // A same-tab redirect came from the app; Passport's start page is only a side action.
      const action = screen.getByRole("button", { name: "Back to the app" });
      expect(action).toHaveClass("w-full");
      expect(screen.getByRole("button", { name: "Go to Passport" })).not.toHaveClass("w-full");
      await userEvent.setup().click(action);
      expect(back).toHaveBeenCalledOnce();
    },
  );

  it("keeps Passport's start page as a side action on a failure in the app's popup", () => {
    Object.defineProperty(window, "opener", { configurable: true, value: { closed: false } });
    renderFlow({ status: "invalid" });

    expect(screen.getByRole("button", { name: "Close window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Passport" })).toBeInTheDocument();
  });
});

it("celebrates an approval like every other finished task, and only an approval", () => {
  renderFlow({ status: "approved", review: REVIEW });
  expect(document.querySelector('img[src*="checkmark.png"]')).not.toBeNull();
  expect(screen.getByRole("button", { name: "Go to Passport" })).toHaveClass("w-full");
  cleanup();

  renderFlow({ status: "cancelled", review: REVIEW });
  expect(document.querySelector('img[src*="checkmark.png"]')).toBeNull();
  cleanup();
});

it("names no app on the outcome of a request nobody verified (M3)", () => {
  renderFlow({ status: "approved", review: NAMED });

  expect(screen.getByRole("heading", { name: "Sign-in approved." })).toBeInTheDocument();
  expect(screen.getByRole("main")).toHaveTextContent("You can go back to the app now.");
  expect(screen.queryByText(/Acme Notes|requesting\.app/u)).toBeNull();
  expect(document.title).toBe("Sign-in approved | Pubky Passport");
  cleanup();
});
