/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthorizationRequestReview } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type { MethodAvailability } from "@/client/logic/homegate/HomegateAvailabilityClient";
import type { StartScreen } from "@/client/logic/universal-signer/signerNavigation";
import { releaseTestOpener } from "@test-utils/boundOpener";
import { makeInstanceConfig } from "@test-utils/instanceConfig";
import { mockGoogleIdentityController } from "@test-utils/mockGoogleIdentityController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { GoogleIdentityConfigurationProvider } from "@/client/ui/googleIdentityConfiguration";
import { HomegateAvailabilityContext } from "@/client/ui/homegateAvailability";
import type { RingProfileControllerPort } from "@/client/ui/passportCollaborators";
import { PassportProviderConfiguration } from "@/client/ui/passportProviderConfiguration";
import { RingProfileConnection } from "@/client/ui/profile/ringProfileConnection";
import { SetupProgressSlot } from "@/client/ui/shared/setupProgress";
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
) {
  render(
    withPassportTestProviders(
      <HomegateAvailabilityContext
        value={{
          methods: {
            google: { status: google },
            sms: { status: "available" },
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
    <AddIdentity
      onComplete={vi.fn()}
      onCreateAccount={vi.fn()}
      onImport={vi.fn()}
      onScreen={vi.fn()}
      screen="join"
      {...props}
    />
  );
}

/** The consent line under the ways to create an account. */
const CONSENT =
  "By joining and creating a Pubky account, you agree to the Terms of Service and Privacy Policy, and confirm you are at least 18 years old.";

/**
 * Passport's own keychain connection as the signer hands it to Sign in (see
 * `universalSignerFlow.tsx`), over a request the keychain never answers.
 */
function keychainConnection() {
  const controller: RingProfileControllerPort = {
    start: vi.fn(async () => Result.ok()),
    poll: vi.fn(() => new Promise<never>(() => undefined)),
    confirm: vi.fn(),
    authorizationUrl: () => "pubkyauth://signin?secret=passport-profile-only",
    isConnected: vi.fn(() => false),
    save: vi.fn(),
    dispose: vi.fn(),
  };
  return function connection(close: (() => void) | undefined, layout?: "card") {
    return (
      <RingProfileConnection
        controller={controller}
        embedded={layout ?? true}
        onBack={close}
        onComplete={vi.fn()}
        openOnReady={close !== undefined}
      />
    );
  };
}

/** A phone: the keychain sign-in waits for its button. */
function stubCoarsePointer() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

it("renders an invite-only instance without Google or Homegate credentials", async () => {
  const onCreateAccount = vi.fn();
  const view = (start: StartScreen, pending?: AuthorizationRequestReview) =>
    withPassportTestProviders(
      <PassportProviderConfiguration
        value={makeInstanceConfig({ features: { google: false }, verificationMethods: ["invite"] })}
      >
        <GoogleIdentityConfigurationProvider googleClientId="" homegateBaseUrl="">
          <AddIdentity
            onComplete={vi.fn()}
            onImport={vi.fn()}
            onCreateAccount={onCreateAccount}
            onScreen={vi.fn()}
            onUseRing={vi.fn()}
            request={pending}
            screen={start}
          />
        </GoogleIdentityConfigurationProvider>
      </PassportProviderConfiguration>,
    );
  const { rerender } = render(view("join"));
  expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /SMS|Lightning|invite/u })).not.toBeInTheDocument();
  // Keys of your own are the one way in; how to verify is asked on the next step.
  expect(screen.getAllByRole("region")).toEqual([
    screen.getByRole("region", { name: "Sovereign & Secure" }),
  ]);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Manage your own keys" }));
  expect(onCreateAccount).toHaveBeenCalledExactlyOnceWith();

  // A request's start page is Join: keys of your own alone, then a recovery file and the keychain.
  rerender(view("sign-in", request({ authenticationMethod: "grant" })));
  expect(screen.getByRole("heading", { level: 1, name: "Let’s join Pubky." })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /SMS|Lightning|invite/u })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Import it" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Use Pubky Ring or Bitkit" })).toBeEnabled();
  expect(screen.getAllByRole("region")).toEqual([
    screen.getByRole("region", { name: "Sovereign & Secure" }),
  ]);
  await user.click(
    within(screen.getByRole("region", { name: "Sovereign & Secure" })).getByRole("button", {
      name: "Manage your own keys",
    }),
  );
  expect(onCreateAccount).toHaveBeenCalledTimes(2);
  expect(onCreateAccount).toHaveBeenLastCalledWith();
});

describe("Join", () => {
  it("is two cards: keys of your own, which ask how to verify next, and Google", async () => {
    const onCreateAccount = vi.fn();
    const onImport = vi.fn();
    renderAddIdentity(addIdentity({ onCreateAccount, onImport }));

    expect(
      screen.getByRole("heading", { level: 1, name: "Let’s join Pubky." }),
    ).toBeInTheDocument();
    expect(screen.getByText("How would you like to create your pubky?")).toBeInTheDocument();
    const cards = screen.getAllByRole("region");
    expect(cards).toEqual([
      screen.getByRole("region", { name: "Sovereign & Secure" }),
      screen.getByRole("region", { name: "Quick & Easy" }),
    ]);
    // Each card is the illustrated card: a picture, its name, one line about it, then its button.
    expect(cards[0]).toHaveTextContent("Take full control of your pubky.");
    expect(cards[1]).toHaveTextContent("Use your existing sign-in methods.");
    expect(cards[0]!.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("identity-keys.png"),
    );
    expect(cards[1]!.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("cloud.png"),
    );
    expect(
      within(cards[1]!).getByRole("button", { name: "Continue with Google" }),
    ).toBeInTheDocument();
    // The ways to verify, the keychain and importing belong to the next step and to Sign in.
    expect(
      screen.queryByRole("button", { name: /SMS|Lightning|invite|Pubky Ring/u }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import it" })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("max-w-[1280px]");
    // What creating an account agrees to, under both cards.
    const consent = screen.getByText((_, element) => element?.textContent === CONSENT);
    expect(consent.tagName).toBe("P");
    expect(cards[1]!.compareDocumentPosition(consent)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    await userEvent
      .setup()
      .click(within(cards[0]!).getByRole("button", { name: "Manage your own keys" }));
    // No method is picked here: account creation asks for one.
    expect(onCreateAccount).toHaveBeenCalledExactlyOnceWith();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("links to Sign in from the header, with none of a request's quiet lines", async () => {
    const onScreen = vi.fn();
    // Without a request there is nothing to hand to the keychain, whatever the shell passes.
    renderAddIdentity(addIdentity({ onScreen, onUseRing: vi.fn() }));

    expect(screen.queryByRole("button", { name: "New here?" })).not.toBeInTheDocument();
    // Sign in has the recovery file and the keychain.
    expect(screen.queryByText("Have a recovery file?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import it" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Use Pubky Ring/u })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign in" }));
    expect(onScreen).toHaveBeenCalledExactlyOnceWith("sign-in");
  });

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

    const card = screen.getByRole("region", { name: "Quick & Easy" });
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
    // Keys of your own never depend on Google's check.
    expect(screen.getByRole("button", { name: "Manage your own keys" })).toBeEnabled();
  });

  it("says when the Google sign-up check failed, not verification methods", () => {
    renderAddIdentity(addIdentity(), "unknown");

    const card = screen.getByRole("region", { name: "Quick & Easy" });
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
  it("leaves the keys card alone when the instance runs without Google", () => {
    renderAddIdentity(
      <PassportProviderConfiguration value={makeInstanceConfig({ features: { google: false } })}>
        {addIdentity()}
      </PassportProviderConfiguration>,
    );

    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("region")).toEqual([
      screen.getByRole("region", { name: "Sovereign & Secure" }),
    ]);
    expect(screen.getByRole("button", { name: "Manage your own keys" })).toBeEnabled();
  });

  it("is the first step of account creation, as the Google screen is; Sign in is not", () => {
    const progress = (view: ReactNode) => {
      renderAddIdentity(
        <>
          <SetupProgressSlot />
          {view}
        </>,
      );
      const stepper = screen.queryByRole("navigation", { name: "Account setup progress" });
      const step = stepper?.textContent ?? null;
      cleanup();
      return step;
    };

    expect(progress(addIdentity())).toContain("Step 1 of 3: Create account");
    expect(progress(addIdentity({ screen: "google" }))).toContain("Step 1 of 3: Create account");
    expect(progress(addIdentity({ screen: "sign-in" }))).toBeNull();
  });
});

describe("Sign in", () => {
  it("is the keychain's own card and a quiet link to import a recovery file on a computer", async () => {
    const onImport = vi.fn();
    const onCreateAccount = vi.fn();
    renderAddIdentity(
      addIdentity({
        screen: "sign-in",
        onCreateAccount,
        onImport,
        onPrevious: vi.fn(),
        ringConnection: keychainConnection(),
      }),
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Sign in to Pubky");
    // One card: the connection's own, named by its visible heading.
    const cards = screen.getAllByRole("region");
    expect(cards).toEqual([screen.getByRole("region", { name: "Scan QR with keychain." })]);
    const keychain = cards[0]!;
    expect(
      within(keychain).getByRole("heading", { level: 2, name: "Scan QR with keychain." }),
    ).toBeInTheDocument();
    expect(keychain).toHaveTextContent(
      "Use Pubky Ring or Bitkit and follow the instructions below.",
    );
    expect(keychain.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("scan.png"),
    );
    // The code at once, with the classic switch right under it, in its column, then the steps.
    const code = await within(keychain).findByRole("img", { name: "Keychain connection QR code" });
    const classic = within(keychain).getByRole("switch", { name: "Older Pubky Ring? Classic QR" });
    const steps = within(keychain).getByRole("list");
    expect(classic.closest("label")!.parentElement).toContainElement(code);
    expect(classic.closest("label")!.parentElement).not.toContainElement(steps);
    expect(code.compareDocumentPosition(classic)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((step) => step.textContent),
    ).toEqual(["Open Pubky Ring or Bitkit", "Tap ‘Scan’", "Scan this QR", "Authorize in the app"]);
    // Nothing to press or cancel on a computer.
    expect(
      screen.queryByRole("button", { name: "Continue with Pubky Ring or Bitkit" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    // Creating an account and Google are Join's, one Back away: nothing here opens either, and
    // nothing here creates an account to agree to.
    expect(screen.queryByRole("button", { name: "Manage your own keys" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Google/u })).not.toBeInTheDocument();
    expect(screen.queryByText("Quick & Easy")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New here?" })).not.toBeInTheDocument();
    expect(screen.queryByText(/By joining and creating/u)).not.toBeInTheDocument();
    // Importing is a quiet text link below the card, read with its question.
    const importFile = screen.getByRole("button", { name: "Import it" });
    expect(keychain).not.toContainElement(importFile);
    expect(importFile).toHaveClass("underline");
    expect(importFile).toHaveAccessibleDescription("Have a recovery file?");
    expect(keychain.compareDocumentPosition(importFile)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // A phone's screen ends on the keychain picture, below the link.
    const phonePicture = document.querySelector('img[src*="keychain.png"]')!;
    expect(phonePicture).toHaveClass("md:hidden");
    expect(importFile.compareDocumentPosition(phonePicture)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    await userEvent.setup().click(importFile);
    expect(onImport).toHaveBeenCalledOnce();
    expect(onCreateAccount).not.toHaveBeenCalled();
  });

  it('names a phone\'s keychain card "Sovereign & Secure" around its one button', async () => {
    stubCoarsePointer();
    renderAddIdentity(
      addIdentity({
        screen: "sign-in",
        onPrevious: vi.fn(),
        ringConnection: keychainConnection(),
      }),
    );

    // The design's Sign in names the keychain section as Join names keys of your own.
    const keychain = screen.getByRole("region", { name: "Sovereign & Secure" });
    expect(screen.getAllByRole("region")).toEqual([keychain]);
    expect(
      within(keychain).getByRole("heading", { level: 2, name: "Sovereign & Secure" }),
    ).toBeInTheDocument();
    expect(keychain).toHaveTextContent("Take full control of your pubky.");
    const start = within(keychain).getByRole("button", {
      name: "Continue with Pubky Ring or Bitkit",
    });
    expect(within(keychain).getAllByRole("button")).toEqual([start]);
    expect(screen.queryByRole("button", { name: /Google/u })).not.toBeInTheDocument();

    // Pressed, the connection takes the button's place in the same card, with Cancel.
    const user = userEvent.setup();
    await user.click(start);
    expect(screen.getByRole("region", { name: "Sovereign & Secure" })).toBe(keychain);
    expect(within(keychain).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(
      within(keychain).getByRole("switch", { name: "Older Pubky Ring? Classic QR" }),
    ).toBeInTheDocument();
  });

  it.each(["onPrevious", "onBack"] as const)(
    "leaves Join's ways in to Join, one Back away, when %s is set",
    async (backProp) => {
      const back = vi.fn();
      const onScreen = vi.fn();
      renderAddIdentity(
        addIdentity({
          screen: "sign-in",
          onScreen,
          [backProp]: back,
          ringConnection: () => <p>Keychain connection</p>,
        }),
      );

      // No header link to Join, and neither of Join's cards nor Google.
      expect(screen.queryByRole("button", { name: "New here?" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Quick & Easy" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Sovereign & Secure" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Google/u })).not.toBeInTheDocument();
      // The keychain and the recovery file stay.
      expect(screen.getByText("Keychain connection")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Import it" })).toBeEnabled();

      await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
      expect(back).toHaveBeenCalledOnce();
      expect(onScreen).not.toHaveBeenCalled();
    },
  );

  it("links to Join from the header only when it has no Back", async () => {
    const onScreen = vi.fn();
    renderAddIdentity(
      addIdentity({ screen: "sign-in", onScreen, ringConnection: keychainConnection() }),
    );

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    // Still the keychain and the recovery file alone: Join has Google.
    expect(screen.getAllByRole("region")).toEqual([
      screen.getByRole("region", { name: "Scan QR with keychain." }),
    ]);
    expect(screen.queryByRole("button", { name: /Google/u })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "New here?" }));
    expect(onScreen).toHaveBeenCalledExactlyOnceWith("join");
  });

  it("gives a computer's keychain card to Passport's own connection, adding nothing around it", () => {
    const connection = vi.fn((): ReactNode => <p>Keychain connection</p>);
    renderAddIdentity(
      addIdentity({ screen: "sign-in", onPrevious: vi.fn(), ringConnection: connection }),
    );

    // The connection draws the whole card: Sign in adds no card, heading or picture around it.
    expect(connection).toHaveBeenCalledWith(undefined, "card");
    expect(screen.getByText("Keychain connection")).toBeInTheDocument();
    expect(screen.queryAllByRole("region")).toEqual([]);
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    expect(document.querySelectorAll('img[src*="scan.png"]')).toHaveLength(0);
    // No button of its own on a computer: the code is shown at once.
    expect(
      screen.queryByRole("button", { name: /^Continue with Pubky Ring/u }),
    ).not.toBeInTheDocument();
    // The keychain picture is the phone's alone.
    const keychainPictures = document.querySelectorAll('img[src*="keychain.png"]');
    expect(keychainPictures).toHaveLength(1);
    expect(keychainPictures[0]).toHaveClass("md:hidden");
  });

  it("keeps a phone's keychain card to Join's frame", () => {
    stubCoarsePointer();
    const connection = vi.fn((): ReactNode => <p>Keychain connection</p>);
    renderAddIdentity(
      addIdentity({ screen: "sign-in", onPrevious: vi.fn(), ringConnection: connection }),
    );

    const keychain = screen.getByRole("region", { name: "Sovereign & Secure" });
    expect(keychain).toHaveTextContent("Take full control of your pubky.");
    // A card from md only, as Join's are, rather than a card at every width.
    expect(keychain).toHaveClass("md:bg-card");
    expect(keychain).not.toHaveClass("bg-card");
    // The card's picture is the scan from lg; the keychain picture is the phone's alone.
    expect(keychain.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("scan.png"),
    );
    const keychainPictures = document.querySelectorAll('img[src*="keychain.png"]');
    expect(keychainPictures).toHaveLength(1);
    expect(keychain).not.toContainElement(keychainPictures[0] as HTMLElement);
    expect(connection).not.toHaveBeenCalled();
  });

  it("leaves Google to Join whatever the sign-up check says", () => {
    renderAddIdentity(addIdentity({ screen: "sign-in", onPrevious: vi.fn() }), "blocked");

    // Neither the button nor the check's note and its Check again reach this screen.
    expect(screen.queryByRole("button", { name: /Google/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Google sign-ups/u)).not.toBeInTheDocument();
  });

  it("leaves the keychain card alone when the instance runs without Google", () => {
    renderAddIdentity(
      <PassportProviderConfiguration value={makeInstanceConfig({ features: { google: false } })}>
        {addIdentity({ screen: "sign-in", ringConnection: keychainConnection() })}
      </PassportProviderConfiguration>,
    );

    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("region")).toEqual([
      screen.getByRole("region", { name: "Scan QR with keychain." }),
    ]);
    expect(screen.getByRole("button", { name: "Import it" })).toBeEnabled();
  });
});

describe("the keychain on Sign in", () => {
  it("shows the keychain sign-in at once on a computer, with nothing to press or cancel", () => {
    const connection = vi.fn((close: (() => void) | undefined) => (
      <p>{close ? "With Cancel" : "Keychain connection QR code"}</p>
    ));
    renderAddIdentity(addIdentity({ screen: "sign-in", ringConnection: connection }));

    // Nothing to press: the connection is the card from the start, as a card, with no Cancel.
    const card = screen.getByText("Keychain connection QR code");
    expect(connection).toHaveBeenCalledWith(undefined, "card");
    expect(connection).not.toHaveBeenCalledWith(expect.any(Function));
    expect(
      screen.queryByRole("button", { name: "Continue with Pubky Ring or Bitkit" }),
    ).not.toBeInTheDocument();
    // It takes no focus from the page's heading.
    expect(card).not.toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });

  it("prepares nothing on a phone until asked, then holds the sign-in in its card with Cancel", async () => {
    stubCoarsePointer();
    const connection = vi.fn((close: (() => void) | undefined) => (
      <div>
        <p>Keychain connection</p>
        <button onClick={close} type="button">
          Cancel
        </button>
      </div>
    ));
    renderAddIdentity(addIdentity({ screen: "sign-in", ringConnection: connection }));

    const card = screen.getByRole("region", { name: "Sovereign & Secure" });
    // No request is made until the person asks: preparing one loads the SDK and opens a request.
    expect(connection).not.toHaveBeenCalled();
    expect(card).not.toContainElement(document.activeElement as HTMLElement);
    const user = userEvent.setup();
    await user.click(
      within(card).getByRole("button", { name: "Continue with Pubky Ring or Bitkit" }),
    );

    // The connection replaces the button inside the card, and focus follows it there.
    expect(within(card).getByText("Keychain connection")).toBeInTheDocument();
    expect(connection).toHaveBeenLastCalledWith(expect.any(Function));
    expect(
      screen.queryByRole("button", { name: "Continue with Pubky Ring or Bitkit" }),
    ).not.toBeInTheDocument();
    expect(card).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Sign in to Pubky");

    await user.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Keychain connection")).not.toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Continue with Pubky Ring or Bitkit" }),
    ).toHaveFocus();
  });
});

describe("Join during a request", () => {
  /** The request's start page, on the screen the shell opens a request on. */
  function renderRequestJoin(
    props: Partial<Parameters<typeof AddIdentity>[0]> = {},
    google: MethodAvailability["status"] = "available",
  ) {
    return renderAddIdentity(
      addIdentity({
        screen: "sign-in",
        request: request({ authenticationMethod: "grant" }),
        onUseRing: vi.fn(),
        ...props,
      }),
      google,
    );
  }

  it("is Join's two cards without its header Sign in, then a recovery file, the keychain and what joining agrees to", async () => {
    const onImport = vi.fn();
    const onUseRing = vi.fn();
    const onScreen = vi.fn();
    renderAddIdentity(
      <PassportProviderConfiguration
        value={makeInstanceConfig({ termsUrl: "https://provider.example/terms" })}
      >
        <SetupProgressSlot />
        {addIdentity({
          screen: "sign-in",
          request: request({ authenticationMethod: "grant" }),
          onCancel: vi.fn(),
          onImport,
          onScreen,
          onUseRing,
        })}
      </PassportProviderConfiguration>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Let’s join Pubky." }),
    ).toBeInTheDocument();
    // The account creation step, as Join is without a request.
    expect(screen.getByRole("navigation", { name: "Account setup progress" })).toHaveTextContent(
      "Step 1 of 3: Create account",
    );
    // No header action: Back answers the app, and Sign in's ways in are on this screen.
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New here?" })).not.toBeInTheDocument();
    const cards = screen.getAllByRole("region");
    expect(cards).toEqual([
      screen.getByRole("region", { name: "Sovereign & Secure" }),
      screen.getByRole("region", { name: "Quick & Easy" }),
    ]);
    expect(within(cards[0]!).getByRole("button", { name: "Manage your own keys" })).toBeEnabled();
    expect(within(cards[1]!).getByRole("button", { name: "Continue with Google" })).toBeEnabled();
    // None of the old request Sign in: no keychain card, no divider, no keychain picture.
    expect(screen.queryByRole("region", { name: /keychain/iu })).not.toBeInTheDocument();
    expect(screen.queryByText(/Sign in with keychain/u)).not.toBeInTheDocument();
    expect(screen.queryByText("or create account")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Continue with Pubky Ring/u }),
    ).not.toBeInTheDocument();
    expect(document.querySelectorAll('img[src*="keychain.png"]')).toHaveLength(0);
    // Under the cards, two quiet lines: a recovery file, read with its question, then the keychain.
    const importFile = screen.getByRole("button", { name: "Import it" });
    expect(importFile).toHaveAccessibleDescription("Have a recovery file?");
    expect(importFile).toHaveClass("underline");
    const keychain = screen.getByRole("button", { name: "Use Pubky Ring or Bitkit" });
    expect(keychain).toHaveClass("underline");
    for (const card of cards) {
      expect(card).not.toContainElement(importFile);
      expect(card).not.toContainElement(keychain);
    }
    expect(cards[1]!.compareDocumentPosition(importFile)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(importFile.compareDocumentPosition(keychain)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // Then what joining agrees to, and the provider's own terms last.
    const consent = screen.getByText((_, element) => element?.textContent === CONSENT);
    expect(keychain.compareDocumentPosition(consent)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const providerTerms = screen.getByText(/^Homeserver provider:/u);
    expect(consent.compareDocumentPosition(providerTerms)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    const user = userEvent.setup();
    await user.click(importFile);
    expect(onImport).toHaveBeenCalledOnce();
    await user.click(keychain);
    expect(onUseRing).toHaveBeenCalledOnce();
    expect(onScreen).not.toHaveBeenCalled();
  });

  it.each(["join", "sign-in"] as const)("is the same Join when opened on %s", (start) => {
    renderRequestJoin({ screen: start });

    expect(
      screen.getByRole("heading", { level: 1, name: "Let’s join Pubky." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Sign in to Pubky" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import it" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Use Pubky Ring or Bitkit" })).toBeEnabled();
  });

  it.each([
    ["the app offers its own", { appOffersKeychain: true }],
    ["nothing can take the request", { onUseRing: undefined }],
  ] as const)("leaves the keychain out where %s, and keeps the recovery file", (_, props) => {
    for (const authenticationMethod of ["grant", "cookie"] as const) {
      renderRequestJoin({ ...props, request: request({ authenticationMethod }) });

      expect(screen.getByRole("button", { name: "Import it" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: /Pubky Ring/u })).not.toBeInTheDocument();
      expect(screen.queryByText(/Bitkit/u)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
      // The consent still follows the recovery file.
      const consent = screen.getByText((_, element) => element?.textContent === CONSENT);
      expect(
        screen.getByRole("button", { name: "Import it" }).compareDocumentPosition(consent),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      cleanup();
    }
  });

  it.each([
    ["a computer", "grant", "Use Pubky Ring or Bitkit"],
    ["a phone", "grant", "Use Pubky Ring or Bitkit"],
    // Bitkit refuses an app's legacy cookie request, so only Pubky Ring is named for it.
    ["a computer", "cookie", "Use Pubky Ring"],
    ["a phone", "cookie", "Use Pubky Ring"],
  ] as const)(
    "hands the request to the keychain on %s, for a %s request",
    async (device, authenticationMethod, name) => {
      if (device === "a phone") stubCoarsePointer();
      const onUseRing = vi.fn();
      const onCreateAccount = vi.fn();
      const connection = vi.fn((): null => null);
      renderRequestJoin({
        request: request({ authenticationMethod }),
        onCreateAccount,
        onUseRing,
        ringConnection: connection,
      });

      const keychain = screen.getByRole("button", { name });
      expect(screen.getAllByRole("button", { name: /^Use Pubky Ring/u })).toEqual([keychain]);
      await userEvent.setup().click(keychain);
      expect(onUseRing).toHaveBeenCalledOnce();
      expect(onCreateAccount).not.toHaveBeenCalled();
      // Passport's own keychain connection is never offered in front of an app's request.
      expect(connection).not.toHaveBeenCalled();
    },
  );

  it("names Bitkit nowhere for a cookie request", () => {
    renderRequestJoin({ request: request({ authenticationMethod: "cookie" }) });

    expect(screen.getByRole("button", { name: "Use Pubky Ring" })).toBeInTheDocument();
    expect(screen.queryByText(/Bitkit/u)).not.toBeInTheDocument();
  });

  it("opens account creation from Manage your own keys, asking how to verify on the next step", async () => {
    const onCreateAccount = vi.fn();
    const onUseRing = vi.fn();
    const onImport = vi.fn();
    const onScreen = vi.fn();
    renderRequestJoin({ onCreateAccount, onUseRing, onImport, onScreen });

    const user = userEvent.setup();
    await user.click(
      within(screen.getByRole("region", { name: "Sovereign & Secure" })).getByRole("button", {
        name: "Manage your own keys",
      }),
    );
    // Straight to account creation, with no method picked here.
    expect(onCreateAccount).toHaveBeenCalledExactlyOnceWith();
    expect(onScreen).not.toHaveBeenCalled();
    expect(onUseRing).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Import it" }));
    expect(onImport).toHaveBeenCalledOnce();
    expect(onCreateAccount).toHaveBeenCalledOnce();
  });

  it.each(["available", "blocked"] as const)(
    "offers Google as Join does while the sign-up check reports %s",
    async (status) => {
      const establishIdentity = renderRequestJoin({}, status);

      const card = screen.getByRole("region", { name: "Quick & Easy" });
      const [shown, hidden] =
        status === "blocked"
          ? ["Restore with Google", "Continue with Google"]
          : ["Continue with Google", "Restore with Google"];
      if (status === "blocked")
        expect(within(card).getByRole("status")).toHaveTextContent(
          /New Google sign-ups aren’t available in your country/u,
        );
      else expect(within(card).queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: hidden })).not.toBeInTheDocument();
      await userEvent.setup().click(within(card).getByRole("button", { name: shown }));
      expect(establishIdentity).toHaveBeenCalledOnce();
    },
  );
});

describe("the Google screen", () => {
  it("explains signing in with Google and starts it from its one button", async () => {
    const establishIdentity = renderAddIdentity(addIdentity({ screen: "google" }));

    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Continue with Google.");
    expect(screen.getByText("Powered by Pubky Passport.")).toBeInTheDocument();
    const about = screen.getByRole("region", { name: "About signing in with Google" });
    for (const point of ["Google’s role:", "Your keys:", "Recovery:", "Split security:"])
      expect(within(about).getByText(point)).toBeInTheDocument();
    // Neither Join's nor Sign in's other ways in: an app's own Google button opened this.
    expect(screen.queryByRole("button", { name: "Manage your own keys" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pubky Ring/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import it" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New here?" })).not.toBeInTheDocument();

    // The first step of creating an account says what that agrees to.
    const consent = screen.getByText((_, element) => element?.textContent === CONSENT);
    expect(about.compareDocumentPosition(consent)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    const google = within(about).getByRole("button", { name: "Continue with Google" });
    expect(google).toHaveAccessibleDescription(
      "Google will ask for two Drive permissions. Tick both.",
    );
    await userEvent.setup().click(google);
    expect(establishIdentity).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("heading", { name: "Requesting Google Drive access." }),
    ).toBeInTheDocument();
  });

  it("says when new Google sign-ups are blocked here, and still restores", () => {
    renderAddIdentity(addIdentity({ screen: "google" }), "blocked");

    const about = screen.getByRole("region", { name: "About signing in with Google" });
    expect(within(about).getByRole("status")).toHaveTextContent(
      /New Google sign-ups aren’t available in your country/u,
    );
    expect(within(about).getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });

  // The server turns the feature off when the provider disables Google or no client ID is set.
  it("offers the request's Join instead where the instance runs without Google", async () => {
    const onCreateAccount = vi.fn();
    const onScreen = vi.fn();
    const onCancel = vi.fn();
    const onImport = vi.fn();
    const onUseRing = vi.fn();
    renderAddIdentity(
      <PassportProviderConfiguration value={makeInstanceConfig({ features: { google: false } })}>
        {addIdentity({
          screen: "google",
          request: request(),
          onCancel,
          onCreateAccount,
          onImport,
          onScreen,
          onUseRing,
        })}
      </PassportProviderConfiguration>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Let’s join Pubky." }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "About signing in with Google" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Google/u })).not.toBeInTheDocument();
    expect(screen.getAllByRole("region")).toEqual([
      screen.getByRole("region", { name: "Sovereign & Secure" }),
    ]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Manage your own keys" }));
    expect(onCreateAccount).toHaveBeenCalledExactlyOnceWith();
    // The request's Join: no Sign in to switch to, its ways in under the card instead.
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Import it" }));
    expect(onImport).toHaveBeenCalledOnce();
    // A cookie request names Pubky Ring alone.
    await user.click(screen.getByRole("button", { name: "Use Pubky Ring" }));
    expect(onUseRing).toHaveBeenCalledOnce();
    expect(onScreen).not.toHaveBeenCalled();
    // Still the request's first step: Back answers the app.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("Google from the start page", () => {
  it.each([true, false])(
    "waits beside Google's own window after Continue with Google, forAuthorization=%s",
    async (forAuthorization) => {
      // Google is on Join, with or without a request (whose start page opens on "sign-in").
      const pending = forAuthorization ? request() : undefined;
      renderAddIdentity(
        addIdentity({
          screen: forAuthorization ? "sign-in" : "join",
          request: pending,
          onUseRing: vi.fn(),
        }),
      );

      await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

      // The pop-up is the default with or without a waiting request: the page does not leave.
      const cancel = await screen.findByRole("button", { name: "Cancel" });
      expect(cancel.closest(".grid")).toContainElement(
        screen.getByRole("button", { name: "Show Google’s window" }),
      );
      expect(screen.queryByRole("main", { name: "Continuing with Google" })).toBeNull();
    },
  );

  it.each(["join", "sign-in", "google"] as const)(
    "continues the Google sign-in by itself on the page Google returned to, from %s",
    async (start) => {
      const establishIdentity = vi.fn(() => new Promise<never>(() => undefined));
      renderAddIdentity(
        addIdentity({ screen: start, request: request(), googleReturn: { onLeave: vi.fn() } }),
        "available",
        establishIdentity,
      );

      // The start page is not shown there: no way in to pick, no second press.
      expect(screen.queryByRole("region", { name: "Sovereign & Secure" })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "About signing in with Google" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("main", { name: "Continuing with Google" })).toBeInTheDocument();
      await vi.waitFor(() => expect(establishIdentity).toHaveBeenCalledOnce());
    },
  );
});

describe("Back", () => {
  it.each(["join", "sign-in", "google"] as const)(
    "returns to where addition was opened from %s",
    async (start) => {
      const onBack = vi.fn();
      renderAddIdentity(addIdentity({ screen: start, onBack }));

      await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
      expect(onBack).toHaveBeenCalledOnce();
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    },
  );

  it.each(["join", "sign-in", "google"] as const)(
    "answers the app on a request's first step, from %s",
    async (start) => {
      const onCancel = vi.fn();
      renderAddIdentity(
        addIdentity({ screen: start, request: request(), onUseRing: vi.fn(), onCancel }),
      );

      // Back is Cancel here: the header carries no Cancel of its own.
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
      expect(onCancel).toHaveBeenCalledOnce();
    },
  );

  it("goes back to the list rather than answering the app when opened from it", async () => {
    const onBack = vi.fn();
    const onCancel = vi.fn();
    renderAddIdentity(
      addIdentity({
        screen: "sign-in",
        request: request(),
        onUseRing: vi.fn(),
        onBack,
        onCancel,
      }),
    );

    expect(screen.getAllByRole("button", { name: "Back" })).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it.each(["join", "sign-in"] as const)(
    "returns first to the start screen %s was switched from, before leaving or answering the app",
    async (start) => {
      const onPrevious = vi.fn();
      const onBack = vi.fn();
      const onCancel = vi.fn();
      renderAddIdentity(
        addIdentity({
          screen: start,
          request: request(),
          onUseRing: vi.fn(),
          onPrevious,
          onBack,
          onCancel,
        }),
      );

      expect(screen.getAllByRole("button", { name: "Back" })).toHaveLength(1);
      await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
      expect(onPrevious).toHaveBeenCalledOnce();
      expect(onBack).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
    },
  );

  it("is left out of the first screen without a request", () => {
    renderAddIdentity(addIdentity());

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });
});

describe("the start page during a request", () => {
  it("flags a request for broad access on its Join while the keychain line hands it on unreviewed", () => {
    const broad = request({
      capabilities: [{ path: "/", read: true, write: true, scope: "broad" }],
    });
    renderAddIdentity(addIdentity({ screen: "sign-in", request: broad, onUseRing: vi.fn() }));

    // A phone opens the keychain app from the line's press, before any review: the warning comes
    // first on the screen.
    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent(/access to all your data/u);
    const line = screen.getByRole("button", { name: "Use Pubky Ring" });
    expect(warning.compareDocumentPosition(line)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    cleanup();

    // Where the app offers its own keychain route, Join only creates or imports; the request is
    // reviewed after that.
    renderAddIdentity(
      addIdentity({
        appOffersKeychain: true,
        screen: "sign-in",
        request: broad,
        onUseRing: vi.fn(),
      }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/access to all your data/u)).not.toBeInTheDocument();
  });

  it("warns about nothing for a request limited to its own folder", () => {
    renderAddIdentity(addIdentity({ screen: "sign-in", request: request(), onUseRing: vi.fn() }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // M3: the app picks its own label and callback, so a request nobody verified names neither.
  it.each(["join", "sign-in", "google"] as const)(
    "names nobody for a request nobody verified, on %s",
    (start) => {
      renderAddIdentity(
        addIdentity({
          screen: start,
          request: request({
            requesterName: "Your Bank Secure Login",
            callbackHost: "login.attacker.example",
          }),
          onUseRing: vi.fn(),
        }),
      );

      expect(screen.queryByText(/Your Bank Secure Login/u)).toBeNull();
      expect(screen.queryByText(/login\.attacker\.example/u)).toBeNull();
    },
  );
});
