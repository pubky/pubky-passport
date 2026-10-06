/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { MethodAvailability } from "@/client/logic/homegate/HomegateAvailabilityClient";
import { bindTestOpener, releaseTestOpener } from "@test-utils/boundOpener";
import { makeInstanceConfig } from "@test-utils/instanceConfig";
import { mockGoogleIdentityController } from "@test-utils/mockGoogleIdentityController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { GoogleIdentityConfigurationProvider } from "@/client/ui/googleIdentityConfiguration";
import { HomegateAvailabilityContext } from "@/client/ui/homegateAvailability";
import { PassportProviderConfiguration } from "@/client/ui/passportProviderConfiguration";
import { AddIdentity } from "./addIdentity";

afterEach(() => {
  cleanup();
  releaseTestOpener();
  vi.unstubAllGlobals();
});

function request(review: Partial<AuthorizationRequestReview> = {}): AuthorizationRequestReview {
  return {
    authenticationMethod: "cookie",
    capabilities: [{ path: "/pub/example.app/", read: true, write: true, scope: "specific" }],
    ...review,
  };
}

function renderAddIdentity(
  view: ReactNode,
  google: MethodAvailability["status"] = "available",
  establishIdentity = vi.fn(() => new Promise<never>(() => undefined)),
  sms: MethodAvailability["status"] = "available",
) {
  render(
    withPassportTestProviders(
      <HomegateAvailabilityContext
        value={{
          methods: {
            google: { status: google },
            sms: { status: sms },
            lightning: { status: "available" },
          },
          retry: vi.fn(),
        }}
      >
        {view}
      </HomegateAvailabilityContext>,
      { createGoogleIdentityController: () => mockGoogleIdentityController({ establishIdentity }) },
    ),
  );
  return establishIdentity;
}

function addIdentity(props: Partial<Parameters<typeof AddIdentity>[0]> = {}) {
  return (
    <AddIdentity onComplete={vi.fn()} onCreateAccount={vi.fn()} onImport={vi.fn()} {...props} />
  );
}

it("renders an invite-only instance without Google or Homegate credentials", () => {
  render(
    withPassportTestProviders(
      <PassportProviderConfiguration
        value={makeInstanceConfig({ features: { google: false }, verificationMethods: ["invite"] })}
      >
        <GoogleIdentityConfigurationProvider googleClientId="" homegateBaseUrl="">
          <AddIdentity
            onComplete={vi.fn()}
            onImport={vi.fn()}
            onCreateAccount={vi.fn()}
            onUseRing={vi.fn()}
          />
        </GoogleIdentityConfigurationProvider>
      </PassportProviderConfiguration>,
    ),
  );
  expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /SMS|Lightning/u })).not.toBeInTheDocument();
  // The invite is the one way to create an account here, so it is the card's button.
  const create = screen.getByRole("region", { name: "Create account" });
  expect(
    within(create)
      .getAllByRole("button")
      .map((button) => button.textContent?.trim()),
  ).toEqual(["Enter invite manually"]);
  expect(screen.getByRole("button", { name: "Import it" })).toBeEnabled();
  expect(
    within(screen.getByRole("region", { name: "Pubky Ring" })).getByRole("button", {
      name: "Continue with Pubky Ring",
    }),
  ).toBeEnabled();
});

it("makes the invite the card's button where neither SMS nor Lightning is offered", () => {
  render(
    withPassportTestProviders(
      <HomegateAvailabilityContext
        value={{
          methods: {
            google: { status: "unavailable" },
            sms: { status: "unavailable" },
            lightning: { status: "unavailable" },
          },
          retry: vi.fn(),
        }}
      >
        {addIdentity()}
      </HomegateAvailabilityContext>,
    ),
  );
  const invite = screen.getByRole("button", { name: "Enter invite manually" });
  expect(invite).toHaveClass("bg-secondary");
  expect(screen.queryByText("Have an invite code?")).not.toBeInTheDocument();
});

it("keeps the invite one quiet step away while other methods are offered", async () => {
  const onCreateAccount = vi.fn();
  renderAddIdentity(addIdentity({ onCreateAccount }));
  const invite = screen.getByRole("button", { name: "Enter invite manually" });
  expect(invite).toHaveClass("underline");
  expect(invite).toHaveAccessibleDescription("Have an invite code?");
  await userEvent.setup().click(invite);
  expect(onCreateAccount).toHaveBeenCalledExactlyOnceWith("invite");
});

describe("AddIdentity", () => {
  it.each(["available", "unavailable", "unknown", "checking", "blocked"] as const)(
    "starts Google restore while the Homegate probe reports %s",
    async (status) => {
      const establishIdentity = renderAddIdentity(addIdentity(), status);

      const google = screen.getByRole("button", {
        name: status === "blocked" ? "Restore with Google" : "Continue with Google",
      });
      expect(google).toBeEnabled();
      await userEvent.setup().click(google);

      expect(establishIdentity).toHaveBeenCalledOnce();
      expect(
        await screen.findByRole("heading", { name: "Requesting Google Drive access." }),
      ).toBeInTheDocument();
    },
  );

  it("explains a regional block beside the Google button, as limited to new sign-ups", () => {
    renderAddIdentity(addIdentity(), "blocked");

    const card = screen.getByRole("region", { name: "Create account" });
    const note = within(card).getByRole("status");
    expect(note).toHaveTextContent(
      "New Google sign-ups aren’t available in your country. You can still restore a pubky you created with Google.",
    );
    expect(note).toHaveAttribute("data-tone", "warning");
    // The button no longer offers what the note rules out, and restoring stays reachable.
    expect(within(card).queryByRole("button", { name: "Continue with Google" })).toBeNull();
    expect(within(card).getByRole("button", { name: "Restore with Google" })).toBeEnabled();
    expect(within(note).getByRole("button", { name: "Check again" })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "Check again" })).toHaveLength(1);
  });

  it("says when the Google sign-up check failed, not verification methods", () => {
    renderAddIdentity(addIdentity(), "unknown");

    const card = screen.getByRole("region", { name: "Create account" });
    expect(within(card).getByRole("status")).toHaveTextContent(
      "Couldn’t check whether new Google sign-ups work where you are. You can still try, and restoring a pubky you created with Google always works.",
    );
    expect(screen.queryByText(/verification methods/u)).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Check again" })).toBeEnabled();
    expect(within(card).getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });

  it.each(["checking", "available"] as const)(
    "shows no availability note while the first check is %s",
    (status) => {
      renderAddIdentity(addIdentity(), status);

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
    },
  );

  // The server turns the feature off when the provider disables Google or no client ID is set.
  it("hides Google when the instance runs without it", () => {
    renderAddIdentity(
      <PassportProviderConfiguration value={makeInstanceConfig({ features: { google: false } })}>
        {addIdentity()}
      </PassportProviderConfiguration>,
    );

    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import it" })).toBeEnabled();
  });

  it("is two cards and a quiet link: the ways to create an account as buttons, Pubky Ring, and import", async () => {
    const onCreateAccount = vi.fn();
    const onImport = vi.fn();
    renderAddIdentity(
      addIdentity({ onCreateAccount, onImport, ringConnection: () => <p>Ring connection</p> }),
    );

    const cards = screen.getAllByRole("region");
    expect(cards).toEqual([
      screen.getByRole("region", { name: "Create account" }),
      screen.getByRole("region", { name: "Pubky Ring" }),
    ]);
    // Buttons only, in one order on screen and for the keyboard: SMS, Lightning, Google, invite.
    const methods = [
      "Continue with SMS",
      "Continue with Lightning",
      "Continue with Google",
      "Enter invite manually",
    ].map((name) => within(cards[0]!).getByRole("button", { name }));
    for (const [index, button] of methods.slice(1).entries())
      expect(methods[index]!.compareDocumentPosition(button)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    // No method is recommended over another, and none carries a description.
    for (const button of methods.slice(0, 2)) expect(button).toHaveClass("bg-secondary");
    expect(screen.queryByText(/keep its key in Pubky Ring or this browser/u)).toBeNull();
    expect(screen.queryByText(/Create or restore an account with Google/u)).toBeNull();
    // Each card is the illustrated card: a picture, its name, one line about it, then its actions.
    expect(cards[0]).toHaveTextContent("Create a pubky and choose where its key lives.");
    expect(cards[1]).toHaveTextContent("Sign in with the key you keep in Pubky Ring.");
    expect(cards[0]!.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("identity-keys.png"),
    );
    expect(cards[1]!.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("scan.png"),
    );
    // A computer's Ring card holds the sign-in itself.
    expect(within(cards[1]!).getByText("Ring connection")).toBeInTheDocument();
    // Importing is a quiet text link below the cards, read with its question.
    const importFile = screen.getByRole("button", { name: "Import it" });
    for (const card of cards) expect(card).not.toContainElement(importFile);
    expect(importFile).toHaveClass("underline");
    expect(importFile).toHaveAccessibleDescription("Have a recovery file?");
    expect(cards[1]!.compareDocumentPosition(importFile)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole("main")).toHaveClass("max-w-[1280px]");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Continue with SMS" }));
    await user.click(screen.getByRole("button", { name: "Continue with Lightning" }));
    await user.click(importFile);
    expect(onCreateAccount.mock.calls).toEqual([["sms"], ["lightning"]]);
    expect(onImport).toHaveBeenCalledOnce();
  });

  it("disables a method that is blocked here and says so once, in view", () => {
    renderAddIdentity(addIdentity(), "available", undefined, "blocked");

    expect(screen.getByRole("button", { name: "Continue with SMS" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue with Lightning" })).toBeEnabled();
    const notes = screen
      .getAllByRole("status")
      .filter((note) => /available in your country/u.test(note.textContent ?? ""));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent(
      "SMS isn’t available in your country. You can use Lightning or an invite code.",
    );
    expect(notes[0]).not.toHaveClass("sr-only");
    expect(screen.getAllByRole("button", { name: "Check again" })).toHaveLength(1);
  });

  it("shows a method still being checked as working, and leaves out one whose check failed", () => {
    renderAddIdentity(addIdentity(), "available", undefined, "checking");
    expect(screen.getByRole("button", { name: "Continue with SMS" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    // The button shows the check; the line about it is announced but takes no room, so nothing
    // under it moves when the check ends.
    expect(screen.getByText("Checking available verification methods…")).toHaveClass("sr-only");
    cleanup();

    renderAddIdentity(addIdentity(), "available", undefined, "unknown");
    expect(screen.queryByRole("button", { name: "Continue with SMS" })).not.toBeInTheDocument();
    expect(screen.getByText(/Couldn’t check all verification methods/u)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Check again" })).toHaveLength(1);
  });

  it.each([
    [
      { request: request({ requesterName: "Example App", callbackHost: "example.app" }) },
      "Signing in to Example App",
    ],
    [{ request: request({ callbackHost: "example.app" }) }, "Signing in to example.app"],
    [{}, "Get your pubky."],
    [{ onBack: vi.fn() }, "Add an account."],
  ])("names the task in the heading with %o", (props, heading) => {
    // A request is named only once the app's v2 hello bound it.
    bindTestOpener("https://example.app");
    renderAddIdentity(addIdentity(props));

    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });

  it("backs the bound app's label with its website, as on the review", () => {
    bindTestOpener("https://login.attacker.example");
    renderAddIdentity(
      addIdentity({
        request: request({
          requesterName: "Your Bank Secure Login",
          callbackHost: "login.attacker.example",
        }),
      }),
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Signing in to Your Bank Secure Login" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" && element.textContent === "Website: login.attacker.example",
      ),
    ).toBeVisible();
  });

  // M3: the app picks its own label and callback, so a request nobody verified names neither.
  it.each([
    ["a label that differs from its website", { callbackHost: "login.attacker.example" }],
    ["a label and no website", {}],
  ])("names nobody for a request nobody verified, with %s", (_case, review) => {
    renderAddIdentity(
      addIdentity({ request: request({ requesterName: "Your Bank Secure Login", ...review }) }),
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Sign-in request.");
    expect(screen.getByText(/^Name in the request:/u)).toHaveTextContent(
      "Name in the request: Your Bank Secure Login (unverified)",
    );
    // The start page warns through its band and heading; its review and Ring hand-off add the
    // notice before anything goes on.
    expect(screen.queryByText(/can’t confirm who sent this request/u)).toBeNull();
    expect(screen.queryByText(/login\.attacker\.example/u)).toBeNull();
  });

  it.each([true, false])(
    "waits beside Google's own window after Continue with Google, forAuthorization=%s",
    async (forAuthorization) => {
      const pending = forAuthorization ? request() : undefined;
      renderAddIdentity(addIdentity({ request: pending, onUseRing: vi.fn() }));

      await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

      // The pop-up is the default with or without a waiting request: the page does not leave.
      const cancel = await screen.findByRole("button", { name: "Cancel" });
      expect(cancel.closest(".grid")).toContainElement(
        screen.getByRole("button", { name: "Show Google’s window" }),
      );
      expect(screen.queryByRole("main", { name: "Continuing with Google" })).toBeNull();
    },
  );

  it("continues the Google sign-in by itself on the page Google returned to", async () => {
    const establishIdentity = vi.fn(() => new Promise<never>(() => undefined));
    renderAddIdentity(
      addIdentity({ request: request(), googleReturn: { onLeave: vi.fn() } }),
      "available",
      establishIdentity,
    );

    // The start page is not shown there: no method to pick, no second press.
    expect(screen.queryByRole("region", { name: "Create account" })).not.toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Continuing with Google" })).toBeInTheDocument();
    await vi.waitFor(() => expect(establishIdentity).toHaveBeenCalledOnce());
  });

  it("offers one Check again for the card when every check failed, in the Google note", () => {
    renderAddIdentity(addIdentity({ ringConnection: () => null }), "unknown", undefined, "unknown");

    // One press re-checks every method, so the button is not repeated under the method list.
    const retry = screen.getByRole("button", { name: "Check again" });
    expect(screen.getByRole("region", { name: "Create account" })).toContainElement(retry);
    expect(retry.closest('[data-tone="info"]')).toHaveTextContent(/new Google sign-ups/u);
    expect(screen.getByText(/Couldn’t check all verification methods/u)).toBeInTheDocument();
  });
});

describe("Pubky Ring on the start page", () => {
  it("shows the Ring sign-in at once on a computer, with nothing to press or cancel", () => {
    const connection = vi.fn((close: (() => void) | undefined) => (
      <p>{close ? "With Cancel" : "Pubky Ring profile connection QR code"}</p>
    ));
    renderAddIdentity(addIdentity({ ringConnection: connection }));

    const card = screen.getByRole("region", { name: "Pubky Ring" });
    // Nothing to press: the card holds the connection from the start, and gives it no Cancel.
    expect(within(card).getByText("Pubky Ring profile connection QR code")).toBeInTheDocument();
    expect(connection).toHaveBeenCalledWith(undefined);
    expect(screen.queryByRole("button", { name: "Sign in with Pubky Ring" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue with Pubky Ring" })).toBeNull();
    // It takes no focus from the page's heading.
    expect(card).not.toContainElement(document.activeElement as HTMLElement);
  });

  it("prepares nothing on a phone until asked, then holds the sign-in in its card with Cancel", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(pointer: coarse)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const connection = vi.fn((close: (() => void) | undefined) => (
      <div>
        <p>Pubky Ring connection</p>
        <button onClick={close} type="button">
          Cancel
        </button>
      </div>
    ));
    renderAddIdentity(addIdentity({ ringConnection: connection }));

    const card = screen.getByRole("region", { name: "Pubky Ring" });
    expect(
      screen.queryByRole("button", { name: "Continue with Pubky Ring" }),
    ).not.toBeInTheDocument();
    // No request is made until the person asks: preparing one loads the SDK and opens a request.
    expect(connection).not.toHaveBeenCalled();
    expect(card).not.toContainElement(document.activeElement as HTMLElement);
    const user = userEvent.setup();
    await user.click(within(card).getByRole("button", { name: "Sign in with Pubky Ring" }));

    // The connection replaces the button inside the card, and focus follows it there.
    expect(within(card).getByText("Pubky Ring connection")).toBeInTheDocument();
    expect(connection).toHaveBeenLastCalledWith(expect.any(Function));
    expect(screen.queryByRole("button", { name: "Sign in with Pubky Ring" })).toBeNull();
    expect(card).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole("heading", { level: 1, name: "Get your pubky." })).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Pubky Ring connection")).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Sign in with Pubky Ring" })).toHaveFocus();
  });

  it("hands a pending request to Ring from the Pubky Ring card", async () => {
    const onUseRing = vi.fn();
    const connection = vi.fn((): null => null);
    renderAddIdentity(addIdentity({ request: request(), onUseRing, ringConnection: connection }));

    const ring = within(screen.getByRole("region", { name: "Pubky Ring" })).getByRole("button", {
      name: "Continue with Pubky Ring",
    });
    // A full button, named as on the identity list.
    expect(ring).toHaveClass("bg-secondary");
    expect(
      screen.queryByRole("button", { name: "Sign in with Pubky Ring" }),
    ).not.toBeInTheDocument();
    await userEvent.setup().click(ring);
    expect(onUseRing).toHaveBeenCalledOnce();
    // Passport's own Ring connection is never offered in front of an app's request.
    expect(connection).not.toHaveBeenCalled();
  });

  it("leaves the Ring card out when the identity list already offers Ring", () => {
    renderAddIdentity(addIdentity({ request: request(), onUseRing: vi.fn(), onBack: vi.fn() }));

    expect(screen.getAllByRole("region")).toEqual([
      screen.getByRole("region", { name: "Create account" }),
    ]);
    expect(screen.queryByRole("button", { name: /Pubky Ring/u })).not.toBeInTheDocument();
    // One card keeps the narrow column.
    expect(screen.getByRole("main")).toHaveClass("max-w-[588px]");
  });
});

describe("the start page as a request's first step", () => {
  it("answers the app with Cancel in the header, beside no Back", async () => {
    const onCancel = vi.fn();
    renderAddIdentity(addIdentity({ request: request(), onUseRing: vi.fn(), onCancel }));

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("flags a request for broad access, since Pubky Ring hands it on without the review", () => {
    renderAddIdentity(
      addIdentity({
        request: request({
          capabilities: [{ path: "/", read: true, write: true, scope: "broad" }],
        }),
        onUseRing: vi.fn(),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This app asks for access to all your data, public and private.",
    );
  });

  it("warns about nothing for a request limited to its own folder", () => {
    renderAddIdentity(addIdentity({ request: request(), onUseRing: vi.fn() }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
