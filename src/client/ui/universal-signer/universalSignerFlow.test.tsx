/** @vitest-environment jsdom */

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import {
  OPENER_KEYCHAIN_FEATURE,
  installOpenerChannel,
} from "@/client/logic/authorization/opener/OpenerChannel";
import { ValidatedPubkyAuthRequest } from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import type {
  LocalIdentityCatalog,
  LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";
import { LocalAccountDraftRepository } from "@/client/logic/local-account/LocalAccountDraftRepository";
import type * as LocalAccountSetup from "@/client/logic/local-account/LocalAccountSetupController";
import type { LocalAccountRegistrationProgress } from "@/client/logic/local-account/LocalAccountSetupController";
import { PUBKY_SECRET_KEY_FORMAT } from "@/client/logic/pubky/pubkyIdentityKey";
import { fakeLocalIdentityController } from "@test-utils/fakeLocalIdentityController";
import { fakePassportAuthorizationController } from "@test-utils/fakePassportAuthorizationController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { makeInstanceConfig } from "@test-utils/instanceConfig";
import { expectResultOk } from "@test-utils/resultAssertions";
import type {
  AuthorizationControllerPort,
  PassportCollaborators,
} from "@/client/ui/passportCollaborators";
import type { PassportProvider } from "@/libs/passportProvider";
import { requestDigest } from "@/libs/requestDigest";
import { UniversalSignerFlow } from "./universalSignerFlow";
import { bindTestOpener, releaseTestOpener } from "@test-utils/boundOpener";

const LOCAL = vi.hoisted(() => ({
  importBackup: vi.fn(),
  registerAccount: vi.fn(),
  verifyBackup: vi.fn(),
  dispose: vi.fn(),
}));
const ADDED = { publicIdentity: { publicKeyZ32: "new-identity" } };
const EXISTING = { publicIdentity: { publicKeyZ32: "existing-identity" } };
const SECOND = { publicIdentity: { publicKeyZ32: "second-identity" } };
/** Its key stays in Pubky Ring: in Passport for its profile only, never to sign a request. */
const RING_HELD = { publicIdentity: { publicKeyZ32: "ring-identity" }, keySource: "ring" } as const;
const CHOOSE_LIST = "Choose the identity to sign in with.";
/** Two saved identities: a request opens on its list (one opens straight on the review). */
const TWO_SAVED = () => ({
  activePublicKeyZ32: EXISTING.publicIdentity.publicKeyZ32,
  identities: [EXISTING, SECOND],
});
const HOMESERVER = "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";
const DRAFT_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const EXACT_REQUEST =
  "pubkyauth://signin?secret=exact-original&relay=https%3A%2F%2Frelay.example%2Finbox";

// Account creation and import construct the setup controller themselves; only its SDK work is faked.
vi.mock("@/client/logic/local-account/LocalAccountSetupController", async (importOriginal) => ({
  ...(await importOriginal<typeof LocalAccountSetup>()),
  LocalAccountSetupController: class {
    hasStartedRegistration = false;
    discardUnregistered() {
      return Result.ok();
    }
    abandonAccount() {
      return Result.ok();
    }
    prepareAccount() {
      return Result.ok(ADDED);
    }
    createBackup() {
      return Result.ok({ bytes: new Uint8Array([1, 2, 3]), fileName: "backup.pkarr" });
    }
    skipVerification() {
      return Result.ok();
    }
    verifyBackup = LOCAL.verifyBackup;
    returnToBackup() {
      return Result.ok();
    }
    registerAccount = LOCAL.registerAccount;
    dispose = LOCAL.dispose;
  },
}));
vi.mock("@/client/logic/backup/BackupImporter", () => ({
  BackupImporter: class {
    importBackup = LOCAL.importBackup;
    republishHomeserver = vi.fn();
    discardPending = vi.fn();
    dispose = LOCAL.dispose;
  },
}));

let state: { catalog: LocalIdentityCatalog; listener?: (() => void) | undefined };
const approve = vi.fn();
const cancel = vi.fn();
const reportPhase = vi.fn();
const review = {
  authenticationMethod: "cookie",
  requesterName: "Original app",
  capabilities: [],
  callbackHost: "original.app",
} as const;

function mount(
  withRequest: boolean,
  collaborators: Partial<PassportCollaborators> = {},
  controllerOverrides: Partial<AuthorizationControllerPort> = {},
) {
  return render(
    withPassportTestProviders(<UniversalSignerFlow />, {
      ...collaborators,
      createLocalIdentityController: () => fakeLocalIdentityController(state),
      createAuthorizationController: () =>
        fakePassportAuthorizationController(
          { current: withRequest ? { status: "review", review } : { status: "manual-entry" } },
          {
            approve,
            cancel,
            externalSignerUrl: () => EXACT_REQUEST,
            reportPhase,
            ...controllerOverrides,
          },
        ),
    }),
  );
}
/**
 * Opens the start page: with a request, from the review that one saved identity opens on (its
 * "or" offers Use another identity, as the list does), on the request's Join; without one,
 * through the switcher, on Join.
 */
async function openAddition(user: ReturnType<typeof userEvent.setup>, withRequest: boolean) {
  if (withRequest) {
    await user.click(await screen.findByRole("button", { name: "Use another identity" }));
    return;
  }
  await user.click(await screen.findByRole("button", { name: "Switch identity" }));
  await user.click(screen.getByRole("button", { name: "Add identity" }));
}
/**
 * Opens where a recovery file is imported: Sign in without a request, the request's Join (under
 * its cards) with one.
 */
async function openSignIn(user: ReturnType<typeof userEvent.setup>, withRequest: boolean) {
  await openAddition(user, withRequest);
  if (!withRequest) await user.click(screen.getByRole("button", { name: "Sign in" }));
}
/**
 * Opens account creation from the start page, on the invite entry: the one way to verify that
 * needs no Homegate. A setup saved from an earlier visit opens instead.
 */
async function openAccountCreation(user: ReturnType<typeof userEvent.setup>, withRequest: boolean) {
  // Join, with or without a request.
  await openAddition(user, withRequest);
  await user.click(await screen.findByRole("button", { name: "Manage your own keys" }));
  await user.click(await screen.findByRole("button", { name: "Invite code" }));
}
/** On the keychain choice, keeps the new key in this browser despite its tradeoffs. */
async function keepKeyInBrowser(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Keep key in this browser" }));
  await user.click(screen.getByRole("button", { name: "Create in browser anyway" }));
}
/** A phone: Ring hand-offs lead with their deep link. */
function stubCoarsePointer() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}
/** From the review, on to the request's Ring hand-off. */
async function expectRingHandoff(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Continue with keychain" }));
  expect(screen.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Pubky authorization QR code" })).toBeInTheDocument();
}
function notifyAdded() {
  // Deliberately leave the older selection active: completion must select the new identity.
  state.catalog = {
    activePublicKeyZ32: EXISTING.publicIdentity.publicKeyZ32,
    identities: [EXISTING, ADDED],
  };
  state.listener?.();
}
function backupFile() {
  const file = new File([new Uint8Array([1, 2, 3])], "backup.pkarr", {
    type: "application/octet-stream",
  });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new Uint8Array([1, 2, 3]).buffer,
  });
  return file;
}

beforeEach(() => {
  // The app's v2 hello bound its request from the host it returns to (A39); `window.opener` is
  // reset, so a test says itself whether this page is the app's popup.
  bindTestOpener("https://original.app");
  vi.stubGlobal("opener", null);
  state = {
    catalog: { activePublicKeyZ32: EXISTING.publicIdentity.publicKeyZ32, identities: [EXISTING] },
  };
  LOCAL.verifyBackup.mockReturnValue(Result.ok());
  vi.stubGlobal("URL", URL);
  URL.createObjectURL = vi.fn(() => "blob:backup");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  releaseTestOpener();
  cleanup();
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  localStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it.each(["list", "add", "start page with only a Ring identity saved"])(
  "reports Ring only when the %s action opens the app request",
  async (entry) => {
    if (entry === "add") state.catalog = { activePublicKeyZ32: null, identities: [] };
    if (entry === "list") state.catalog = TWO_SAVED();
    // A saved Ring identity cannot sign here: the request opens as if nothing were saved.
    if (entry.endsWith("Ring identity saved"))
      state.catalog = {
        activePublicKeyZ32: RING_HELD.publicIdentity.publicKeyZ32,
        identities: [RING_HELD],
      };
    const user = userEvent.setup();
    mount(true);
    expect(reportPhase).not.toHaveBeenCalled();
    // The list's "or" offers the keychain; the start page's Join a quiet line under its cards,
    // named after Pubky Ring alone for this legacy cookie request.
    await user.click(
      await screen.findByRole("button", {
        name: entry === "list" ? "Continue with keychain" : "Use Pubky Ring",
      }),
    );
    expect(reportPhase).toHaveBeenCalledExactlyOnceWith("ring");
    expect(screen.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
    expect(approve).not.toHaveBeenCalled();
  },
);

it("opens a request entered from an identity's overview on that identity's review", async () => {
  state.catalog = TWO_SAVED();
  // The note the overview's Authorize left before the page reloaded onto the request.
  const takeAuthorizeFromIdentity = vi.fn(() => EXISTING.publicIdentity.publicKeyZ32);
  mount(true, { takeAuthorizeFromIdentity });

  expect(await screen.findByRole("button", { name: "Authorize" })).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: CHOOSE_LIST })).not.toBeInTheDocument();
  expect(takeAuthorizeFromIdentity).toHaveBeenCalledOnce();
  // Switch still leads to the list.
  await userEvent.setup().click(screen.getByRole("button", { name: "Switch identity" }));
  expect(screen.getByRole("list", { name: CHOOSE_LIST })).toBeInTheDocument();
});

it("asks which identity to use when the note names one that is not active", async () => {
  state.catalog = TWO_SAVED();
  mount(true, { takeAuthorizeFromIdentity: () => SECOND.publicIdentity.publicKeyZ32 });

  expect(await screen.findByRole("list", { name: CHOOSE_LIST })).toBeInTheDocument();
});

it("lists only the identities whose key this browser holds for a request", async () => {
  state.catalog = {
    activePublicKeyZ32: RING_HELD.publicIdentity.publicKeyZ32,
    identities: [RING_HELD, EXISTING, SECOND],
  };
  mount(true);

  const list = await screen.findByRole("list", { name: CHOOSE_LIST });
  expect(within(list).getAllByRole("button")).toHaveLength(2);
  expect(screen.queryByText("Key in Pubky Ring")).not.toBeInTheDocument();
  // A key held in Ring signs through the request's Ring hand-off only.
  expect(screen.getByRole("button", { name: "Continue with keychain" })).toBeInTheDocument();
});

it("reviews with the one identity that can sign although a Ring identity is saved too", async () => {
  state.catalog = {
    activePublicKeyZ32: EXISTING.publicIdentity.publicKeyZ32,
    identities: [RING_HELD, EXISTING],
  };
  mount(true);

  expect(await screen.findByRole("button", { name: "Authorize" })).toBeInTheDocument();
});

it("gives a Ring identity's overview its profile, and nothing that signs or handles a key", async () => {
  state.catalog = {
    activePublicKeyZ32: RING_HELD.publicIdentity.publicKeyZ32,
    identities: [RING_HELD],
  };
  mount(false);

  expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit profile" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Authorize an app" })).not.toBeInTheDocument();
  // There is nothing to manage: Log out sits on the overview, in Manage's place.
  expect(screen.queryByRole("button", { name: "Manage identity" })).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Log out" }));
  expect(
    screen.getByRole("heading", { name: "Remove this identity from this browser?" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Remove from this browser" }));
  // Removed, the page lands where Manage's removal landed: home, here the start page's Join.
  expect(state.catalog?.identities).toEqual([]);
  expect(await screen.findByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
});

it("lands on the next identity's overview after removing a Ring identity beside it", async () => {
  state.catalog = {
    activePublicKeyZ32: RING_HELD.publicIdentity.publicKeyZ32,
    identities: [RING_HELD, EXISTING],
  };
  mount(false);
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Log out" }));
  await user.click(screen.getByRole("button", { name: "Remove from this browser" }));
  expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Manage identity" })).toBeInTheDocument();
  expect(state.catalog?.identities).toEqual([EXISTING]);
});

it("leaving the Ring view clears its intent before returning to the list", async () => {
  const user = userEvent.setup();
  const leaveExternalSigner = vi.fn();
  state.catalog = TWO_SAVED();
  mount(true, {}, { leaveExternalSigner });
  await user.click(await screen.findByRole("button", { name: "Continue with keychain" }));
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(leaveExternalSigner).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("list", { name: "Choose the identity to sign in with." }),
  ).toBeInTheDocument();
});

it("offers nothing to report on the Ring view, and goes home once Ring's answer reached the app", async () => {
  const user = userEvent.setup();
  state.catalog = TWO_SAVED();
  const authorization: {
    current: PassportAuthorizationViewState;
    listener?: ((state: PassportAuthorizationViewState) => void) | undefined;
  } = { current: { status: "review", review } };
  mount(
    true,
    {},
    {
      getState: () => authorization.current,
      subscribe: (listener) => {
        authorization.listener = listener;
        return () => {
          authorization.listener = undefined;
        };
      },
    },
  );
  await user.click(await screen.findByRole("button", { name: "Continue with keychain" }));
  expect(screen.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /approved|Back to /iu })).toBeNull();

  // The controller's watch saw Ring's answer, with no app page to hand it back to.
  act(() => {
    authorization.current = { status: "handed-off", review };
    authorization.listener?.(authorization.current);
  });
  expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /^Return to/u })).toBeNull();
  expect(screen.queryByRole("complementary", { name: /original\.app/u })).toBeNull();
  expect(approve).not.toHaveBeenCalled();
});

describe("shared addition navigation", () => {
  it("opens on Join with nothing saved, and Sign in places the keychain before backup import, with Back to Join", async () => {
    state.catalog = { activePublicKeyZ32: null, identities: [] };
    const user = userEvent.setup();
    mount(false);

    // A new account: keys of your own, or Google. Nothing to import there.
    expect(await screen.findByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Sovereign & Secure" })).getByRole("button", {
        name: "Manage your own keys",
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Quick & Easy" })).getByRole("button", {
        name: "Continue with Google",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import it" })).not.toBeInTheDocument();
    // The first screen without a request: nowhere to go back to.
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("heading", { name: "Sign in to Pubky" })).toBeInTheDocument();
    // The keychain alone, then the recovery file: Google and new keys stay on Join.
    expect(screen.getAllByRole("region")).toEqual([
      screen.getByRole("region", { name: "Scan QR with keychain." }),
    ]);
    const keychain = screen.getByRole("region", { name: "Scan QR with keychain." });
    const importBackup = screen.getByRole("button", { name: "Import it" });
    expect(keychain.compareDocumentPosition(importBackup)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByRole("button", { name: /Google/u })).not.toBeInTheDocument();

    // Join is one Back away, so the header has no New here?.
    expect(screen.queryByRole("button", { name: "New here?" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
  });

  it("opens a request with nothing saved on Join, with a recovery file and the keychain under its cards", async () => {
    state.catalog = { activePublicKeyZ32: null, identities: [] };
    const user = userEvent.setup();
    mount(true);

    expect(await screen.findByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in to Pubky" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getAllByRole("region")).toEqual([
      screen.getByRole("region", { name: "Sovereign & Secure" }),
      screen.getByRole("region", { name: "Quick & Easy" }),
    ]);
    expect(
      within(screen.getByRole("region", { name: "Sovereign & Secure" })).getByRole("button", {
        name: "Manage your own keys",
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Quick & Easy" })).getByRole("button", {
        name: "Continue with Google",
      }),
    ).toBeInTheDocument();
    // Nothing switches to Sign in: its ways in are the quiet lines under the cards.
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New here?" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import it" })).toBeInTheDocument();
    // The bound app offers no keychain of its own, so Passport hands its cookie request to Ring.
    const keychain = screen.getByRole("button", { name: "Use Pubky Ring" });
    // The request's first step: Back answers the app, and there is no Cancel beside it.
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    // The keychain line opens the request's keychain hand-off, and Back returns to this Join.
    await user.click(keychain);
    expect(reportPhase).toHaveBeenCalledExactlyOnceWith("ring");
    expect(screen.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
    expect(screen.getByRole("img", { name: "Pubky authorization QR code" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Pubky Ring" })).toBeInTheDocument();
    expect(cancel).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it.each([
    ["join", "Let’s join Pubky."],
    ["google", "Continue with Google."],
  ] as const)(
    "opens on the app's %s entry although identities are saved, with Back to their list",
    async (entry, heading) => {
      state.catalog = TWO_SAVED();
      const user = userEvent.setup();
      const entered = { status: "review", review, entry } as const;
      mount(true, {}, { getState: () => entered });

      // The app's own "Join now" or "Continue with Google" asked for this screen.
      expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: CHOOSE_LIST })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Back" }));
      expect(screen.getByRole("list", { name: CHOOSE_LIST })).toBeInTheDocument();
      expect(cancel).not.toHaveBeenCalled();
    },
  );

  it("answers the app with Back from its Google entry when nothing is saved", async () => {
    state.catalog = { activePublicKeyZ32: null, identities: [] };
    const user = userEvent.setup();
    const entered = { status: "review", review, entry: "google" } as const;
    mount(true, {}, { getState: () => entered });

    expect(
      await screen.findByRole("heading", { name: "Continue with Google." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("returns Back from the keychain hand-off to the Join the app opened, and only then to the list", async () => {
    state.catalog = TWO_SAVED();
    const user = userEvent.setup();
    const entered = { status: "review", review, entry: "join" } as const;
    mount(true, {}, { getState: () => entered });

    expect(await screen.findByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
    // The app's Join has no Sign in to switch to; the keychain is a line under its cards.
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use Pubky Ring" }));
    expect(screen.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeInTheDocument();
    // Back retraces the start page's own steps first; the request is still waiting.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: CHOOSE_LIST })).not.toBeInTheDocument();
    // On the request's first screen, Back leads where it was opened from: the saved identities.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("list", { name: CHOOSE_LIST })).toBeInTheDocument();
    expect(cancel).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it("returns from account creation to the Join the app opened, whose Back answers the app", async () => {
    state.catalog = { activePublicKeyZ32: null, identities: [] };
    const user = userEvent.setup();
    const entered = { status: "review", review, entry: "join" } as const;
    mount(true, {}, { getState: () => entered });

    await screen.findByRole("heading", { name: "Let’s join Pubky." });
    await user.click(screen.getByRole("button", { name: "Manage your own keys" }));
    expect(
      await screen.findByRole("heading", { name: "Prove you’re not a robot." }),
    ).toBeInTheDocument();
    // Back from account creation lands on the Join it was opened from, as it was.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Pubky Ring" })).toBeInTheDocument();
    expect(cancel).not.toHaveBeenCalled();
    // On the request's first screen, Back answers the app.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(approve).not.toHaveBeenCalled();
  });

  it("keeps the plain start page free of the request's keychain button", async () => {
    state.catalog = { activePublicKeyZ32: null, identities: [] };
    const user = userEvent.setup();
    mount(false);

    await user.click(await screen.findByRole("button", { name: "Sign in" }));
    // Its keychain card is Passport's own sign-in (a computer sees its code in the card at once).
    const keychain = screen.getByRole("region", { name: "Scan QR with keychain." });
    expect(
      within(keychain).getByRole("switch", { name: "Older Pubky Ring? Classic QR" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Continue with Pubky Ring or Bitkit" }),
    ).not.toBeInTheDocument();
    // Nor the request's hand-off line, no account creation, no Google, and Join stays one Back
    // away rather than a header link.
    expect(screen.queryByRole("button", { name: /^Use Pubky Ring/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage your own keys" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Quick & Easy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New here?" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it.each([false, true])("returns import to its origin with request=%s", async (withRequest) => {
    const user = userEvent.setup();
    let finish!: () => void;
    LOCAL.importBackup.mockImplementation(
      () =>
        new Promise((resolve) => {
          notifyAdded();
          finish = () => resolve(Result.ok({ status: "imported", identity: ADDED }));
        }),
    );
    mount(withRequest);
    await openSignIn(user, withRequest);
    await user.click(screen.getByRole("button", { name: "Import it" }));
    await user.upload(screen.getByLabelText("Recovery file"), backupFile());
    await user.type(screen.getByLabelText("Recovery file password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Import recovery file" }));
    expect(
      await screen.findByRole("heading", { name: "Import recovery file." }),
    ).toBeInTheDocument();
    expect(approve).not.toHaveBeenCalled();
    if (withRequest)
      expect(
        screen.getAllByRole("complementary", { name: "Signing in to original.app" }),
      ).toHaveLength(1);
    await act(async () => finish());
    expect(
      await screen.findByRole("heading", {
        name: withRequest ? "Signing in to Original app" : "Your pubky.",
      }),
    ).toBeInTheDocument();
    expect(state.catalog.activePublicKeyZ32).toBe("new-identity");
    if (withRequest) await expectRingHandoff(user);
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "keeps local setup through backup verification and registration with request=%s, skip=%s",
    async (withRequest, skip) => {
      const user = userEvent.setup();
      let finish!: () => void;
      let progress!: (step: LocalAccountRegistrationProgress) => void;
      LOCAL.registerAccount.mockImplementation(
        (onProgress: typeof progress) =>
          new Promise((resolve) => {
            progress = onProgress;
            notifyAdded();
            finish = () => resolve(Result.ok(ADDED));
          }),
      );
      mount(withRequest);
      await openAccountCreation(user, withRequest);
      expect(
        screen.queryByRole("button", { name: "Continue with Google" }),
      ).not.toBeInTheDocument();
      await user.type(screen.getByLabelText("Enter invite code"), "AB12-CD34-EF56");
      await screen.findByText("Invite verified with the homeserver.");
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await keepKeyInBrowser(user);
      await user.type(await screen.findByLabelText("Enter strong password"), "correct horse");
      await user.click(screen.getByRole("button", { name: "Download recovery file" }));
      act(notifyAdded);
      expect(screen.getByRole("heading", { name: "Verify recovery file." })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Continue with keychain" }),
      ).not.toBeInTheDocument();
      expect(LOCAL.registerAccount).not.toHaveBeenCalled();
      if (skip) {
        await user.click(screen.getByRole("button", { name: "Skip this check (not recommended)" }));
        expect(LOCAL.verifyBackup).not.toHaveBeenCalled();
      } else {
        await user.upload(screen.getByLabelText("Recovery file"), backupFile());
        await user.type(screen.getByLabelText("Recovery file password"), "correct horse");
        await user.click(screen.getByRole("button", { name: "Verify and create account" }));
      }
      expect(
        await screen.findByRole("heading", { name: "Setting up your pubky." }),
      ).toBeInTheDocument();
      expect(screen.getByText("Create your account").closest("li")).toHaveAttribute(
        "aria-current",
        "step",
      );
      act(() => progress("publishing"));
      expect(screen.getByText("Publish PKDNS records").closest("li")).toHaveAttribute(
        "aria-current",
        "step",
      );
      expect(screen.getByText("Create your account").closest("li")).toHaveTextContent("complete");
      act(() => progress("activating"));
      expect(screen.getByText("Finish setup").closest("li")).toHaveAttribute(
        "aria-current",
        "step",
      );
      await act(async () => finish());
      expect(
        await screen.findByRole("heading", {
          name: withRequest ? "Signing in to Original app" : "Your pubky.",
        }),
      ).toBeInTheDocument();
      expect(state.catalog.activePublicKeyZ32).toBe("new-identity");
      expect(approve).not.toHaveBeenCalled();
      if (withRequest) await expectRingHandoff(user);
    },
  );

  it.each([false, true])(
    "asks for the profile once after creation, and Skip for now goes on to where the person was going, request=%s",
    async (withRequest) => {
      const user = userEvent.setup();
      const created = { ...ADDED, profileSetupRequired: true as const };
      LOCAL.registerAccount.mockImplementation(async () => {
        state.catalog = {
          activePublicKeyZ32: EXISTING.publicIdentity.publicKeyZ32,
          identities: [EXISTING, created],
        };
        state.listener?.();
        return Result.ok(created);
      });
      const announced = vi.spyOn(toast, "success");
      mount(withRequest);
      await openAccountCreation(user, withRequest);
      await user.type(screen.getByLabelText("Enter invite code"), "AB12-CD34-EF56");
      await screen.findByText("Invite verified with the homeserver.");
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await keepKeyInBrowser(user);
      await user.type(await screen.findByLabelText("Enter strong password"), "correct horse");
      await user.click(screen.getByRole("button", { name: "Download recovery file" }));
      await user.click(screen.getByRole("button", { name: "Skip this check (not recommended)" }));

      // The account exists now: a key made in this browser says so in a toast, and the profile
      // follows at once.
      expect(
        await screen.findByRole("heading", { name: "Create your profile." }),
      ).toBeInTheDocument();
      // Once, and the same with or without a request.
      expect(announced.mock.calls.filter(([title]) => title === "Account created")).toEqual([
        ["Account created", { description: "Your key is saved only in this browser." }],
      ]);
      // Skip for now is the one way on without a profile; there is no Back into creation.
      expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Skip for now" }));

      // Neither a backup detour nor Manage: the request's review, or the overview.
      expect(
        await screen.findByRole("heading", {
          name: withRequest ? "Signing in to Original app" : "Your pubky.",
        }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Choose backup method" })).toBeNull();
      if (withRequest) expect(screen.getByRole("button", { name: "Authorize" })).toBeEnabled();
      else expect(screen.getByRole("button", { name: "Set up profile" })).toBeInTheDocument();
      expect(state.catalog.activePublicKeyZ32).toBe("new-identity");
      expect(cancel).not.toHaveBeenCalled();
    },
  );

  it("offers no skip after creation when the app requires a profile", async () => {
    const user = userEvent.setup();
    const created = { ...ADDED, profileSetupRequired: true as const };
    LOCAL.registerAccount.mockImplementation(async () => {
      state.catalog = {
        activePublicKeyZ32: EXISTING.publicIdentity.publicKeyZ32,
        identities: [EXISTING, SECOND, created],
      };
      state.listener?.();
      return Result.ok(created);
    });
    const required = { status: "review", review, profileRequired: true } as const;
    // Two saved identities, so the request opens on its list, where a new account starts.
    state.catalog = TWO_SAVED();
    const announced = vi.spyOn(toast, "success");
    mount(true, {}, { getState: () => required });
    await user.click(await screen.findByRole("button", { name: "Use another identity" }));
    await user.click(await screen.findByRole("button", { name: "Manage your own keys" }));
    await user.click(await screen.findByRole("button", { name: "Invite code" }));
    await user.type(screen.getByLabelText("Enter invite code"), "AB12-CD34-EF56");
    await screen.findByText("Invite verified with the homeserver.");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await keepKeyInBrowser(user);
    await user.type(await screen.findByLabelText("Enter strong password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Download recovery file" }));
    await user.click(screen.getByRole("button", { name: "Skip this check (not recommended)" }));

    expect(
      await screen.findByRole("heading", { name: "Create your profile." }),
    ).toBeInTheDocument();
    expect(announced).toHaveBeenCalledWith("Account created", expect.anything());
    expect(
      screen.getByText(
        "The app you’re signing in to needs a public profile. Add at least a name to continue.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip for now" })).not.toBeInTheDocument();
    // Back leads to the identity list, where the request can be cancelled.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      await screen.findByRole("list", { name: "Choose the identity to sign in with." }),
    ).toBeInTheDocument();
    expect(approve).not.toHaveBeenCalled();
  });

  it("backs out of import, the start page and Pubky Ring to the review they were opened from", async () => {
    const user = userEvent.setup();
    mount(true);
    // One saved identity: the request opens on its review, with no list to switch to.
    expect(await screen.findByRole("button", { name: "Authorize" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch identity" })).not.toBeInTheDocument();
    await openAddition(user, true);
    // Use another identity opens the start page on the request's Join; Back, not Cancel, leaves it.
    expect(screen.getByRole("heading", { name: "Let’s join Pubky." })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Import it" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    // Back from import returns to Join, whose keychain line hands the request on as well.
    expect(screen.getByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Pubky Ring" })).toBeInTheDocument();
    // Account creation opens from Join too, and its Back returns there.
    await user.click(screen.getByRole("button", { name: "Manage your own keys" }));
    expect(screen.getByRole("heading", { name: "Prove you’re not a robot." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
    // Join returns to the review.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Signing in to Original app" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Authorize" })).toBeInTheDocument();

    // Ring gets the request unchanged from the review, and Back returns to the review.
    stubCoarsePointer();
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign });
    await user.click(screen.getByRole("button", { name: "Continue with keychain" }));
    expect(reportPhase).toHaveBeenCalledExactlyOnceWith("ring");
    expect(screen.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeInTheDocument();
    // A phone follows the unchanged request straight to Ring.
    expect(assign).toHaveBeenCalledExactlyOnceWith(EXACT_REQUEST);
    expect(screen.getByRole("link", { name: "Opening Pubky Ring…" })).toHaveAttribute(
      "href",
      EXACT_REQUEST,
    );
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Authorize" })).toBeInTheDocument();
    expect(cancel).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it("offers Switch on the review only when another identity can sign", async () => {
    // Two identities whose key this browser holds: Switch leads to the list.
    state.catalog = TWO_SAVED();
    mount(true, { takeAuthorizeFromIdentity: () => EXISTING.publicIdentity.publicKeyZ32 });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Switch identity" }));
    expect(screen.getByRole("list", { name: CHOOSE_LIST })).toBeInTheDocument();
    cleanup();

    // A Ring identity beside the one that can sign is not one to switch to.
    state.catalog = {
      activePublicKeyZ32: EXISTING.publicIdentity.publicKeyZ32,
      identities: [EXISTING, RING_HELD],
    };
    mount(true);
    expect(await screen.findByRole("button", { name: "Authorize" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch identity" })).not.toBeInTheDocument();
    // Use another identity covers adding one.
    expect(screen.getByRole("button", { name: "Use another identity" })).toBeEnabled();
  });
});

describe("the request's keychain line and the app's hello", () => {
  const APP_REQUEST =
    "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
  /**
   * Makes this page the app's popup again, its hello not bound yet (the hello grace), as the page
   * entry leaves it; the returned function delivers that hello with the app's features.
   */
  function appPopup() {
    releaseTestOpener();
    const opener = { postMessage: vi.fn() };
    vi.stubGlobal("opener", opener);
    const validated = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(APP_REQUEST));
    if (Result.isError(validated)) throw new Error(validated.error.code);
    installOpenerChannel(window, { status: "valid", request: validated.value });
    return (features: readonly string[]) =>
      act(() => {
        window.dispatchEvent(
          Object.assign(new Event("message"), {
            source: opener,
            origin: "https://original.app",
            data: {
              type: "pubky-passport.hello",
              version: 2,
              attemptId: "0123456789abcdef",
              features,
              request: requestDigest(APP_REQUEST),
            },
          }),
        );
      });
  }

  beforeEach(() => {
    // The hello's grace runs on the clock alone: a slow render never ends it here.
    vi.useFakeTimers({ toFake: ["Date"] });
    state.catalog = { activePublicKeyZ32: null, identities: [] };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the line back while the app's hello may still come, then offers it to an app without its own", async () => {
    const hello = appPopup();
    mount(true);

    expect(await screen.findByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
    // It would flash and go for an app that offers its own keychain.
    expect(screen.getByRole("button", { name: "Import it" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Use Pubky Ring/u })).not.toBeInTheDocument();

    hello(["outcome-v2", "status"]);
    expect(screen.getByRole("button", { name: "Use Pubky Ring" })).toBeInTheDocument();
  });

  it("leaves the line out for an app whose hello offers its own keychain", async () => {
    const hello = appPopup();
    mount(true);
    await screen.findByRole("heading", { name: "Let’s join Pubky." });

    hello(["outcome-v2", "status", OPENER_KEYCHAIN_FEATURE]);
    // The app is named now, and its own code or button is the keychain's way in.
    expect(
      screen.getByRole("complementary", { name: "Signing in to original.app" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Use Pubky Ring/u })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import it" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage your own keys" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });
});

describe("account creation navigation", () => {
  function saveDraft({ registrationStarted = false } = {}) {
    const drafts = new LocalAccountDraftRepository();
    expectResultOk(
      drafts.create(
        {
          publicIdentity: { publicKeyZ32: DRAFT_KEY },
          invite: { homeserverPubky: HOMESERVER, signupToken: "saved-invite" },
          step: "password",
        },
        { bytes: new Uint8Array(32).fill(7), format: PUBKY_SECRET_KEY_FORMAT },
      ),
    );
    if (registrationStarted) expectResultOk(drafts.markRegistrationStarted(DRAFT_KEY));
  }

  /**
   * Through Join's Manage your own keys, which a setup saved from an earlier visit opens at the
   * keychain choice; with `invite`, on to the invite entry.
   */
  async function openAccountCreation(
    user: ReturnType<typeof userEvent.setup>,
    { invite = false } = {},
  ) {
    await user.click(await screen.findByRole("button", { name: "Switch identity" }));
    await user.click(screen.getByRole("button", { name: "Add identity" }));
    await user.click(screen.getByRole("button", { name: "Manage your own keys" }));
    if (invite) await user.click(await screen.findByRole("button", { name: "Invite code" }));
  }

  it("does not force an unsubmitted saved setup and reopens it at the signer choice", async () => {
    saveDraft();
    const user = userEvent.setup();
    mount(false);

    expect(await screen.findByRole("button", { name: "Switch identity" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pick your keychain." })).not.toBeInTheDocument();
    await openAccountCreation(user);

    expect(screen.getByRole("heading", { name: "Pick your keychain." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Protect your key." })).not.toBeInTheDocument();
  });

  it("keeps a resumed invite for Ring after backing out of Passport", async () => {
    saveDraft();
    stubCoarsePointer();
    const user = userEvent.setup();
    mount(false);
    await openAccountCreation(user);

    await keepKeyInBrowser(user);
    expect(await screen.findByRole("heading", { name: "Protect your key." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Pick your keychain." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue with keychain" }));

    const ring = screen.getByRole("link", { name: /Authorize & configure/ });
    expect(new URL(ring.getAttribute("href")!).searchParams.get("st")).toBe("saved-invite");
  });

  it("resumes a submitted setup on load with only its own key left to finish it", async () => {
    saveDraft({ registrationStarted: true });
    mount(false);

    // Only this browser's key can finish, so there is no signer left to choose.
    expect(
      await screen.findByRole("heading", { name: "Finish your account." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/The setup you started is saved in this browser/u)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Continue with keychain" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveClass("bg-brand/16");
  });

  it.each([true, false])(
    "goes Back from a setup resumed on load to the start page's first screen, request=%s",
    async (withRequest) => {
      saveDraft({ registrationStarted: true });
      mount(withRequest);
      const user = userEvent.setup();

      await screen.findByRole("heading", { name: "Finish your account." });
      await user.click(screen.getByRole("button", { name: "Back" }));
      // Join either way; only a request's offers its recovery file and keychain under the cards.
      expect(await screen.findByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
      expect(screen.queryAllByRole("button", { name: "Import it" })).toHaveLength(
        withRequest ? 1 : 0,
      );
      expect(screen.queryAllByRole("button", { name: "Sign in" })).toHaveLength(
        withRequest ? 0 : 1,
      );
    },
  );

  /** Submits a manual invite with a Passport key, then drops the key after sign-in fails. */
  async function abandonSubmittedInvite(
    user: ReturnType<typeof userEvent.setup>,
    status: Awaited<ReturnType<PassportCollaborators["checkSignupToken"]>>,
  ) {
    const checkSignupToken = vi
      .fn<PassportCollaborators["checkSignupToken"]>()
      .mockResolvedValue("valid");
    LOCAL.registerAccount.mockImplementation(async function (this: {
      hasStartedRegistration: boolean;
    }) {
      this.hasStartedRegistration = true;
      return Result.err({ code: "signin_failed" });
    });
    mount(false, { checkSignupToken });
    await openAccountCreation(user, { invite: true });
    await user.type(screen.getByLabelText("Enter invite code"), "AB12-CD34-EF56");
    await screen.findByText("Invite verified with the homeserver.");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await keepKeyInBrowser(user);
    await user.type(await screen.findByLabelText("Enter strong password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Download recovery file" }));
    await user.click(screen.getByRole("button", { name: "Skip this check (not recommended)" }));
    await user.click(await screen.findByRole("button", { name: "Start over" }));
    await user.type(screen.getByRole("textbox", { name: "Type DELETE to confirm" }), "DELETE");
    checkSignupToken.mockResolvedValue(status);
    await user.click(screen.getByRole("button", { name: "Remove key and start over" }));
    await vi.waitFor(() =>
      expect(checkSignupToken).toHaveBeenLastCalledWith(
        { homeserverPubky: HOMESERVER, signupToken: "AB12-CD34-EF56" },
        expect.any(AbortSignal),
      ),
    );
    return checkSignupToken;
  }

  it.each([
    ["used", false],
    ["not_found", false],
    ["valid", true],
    ["unknown", true],
  ] as const)(
    "rechecks a submitted invite after starting over and keeps it only if unused: %s",
    async (status, kept) => {
      const user = userEvent.setup();
      await abandonSubmittedInvite(user, status);

      if (kept) {
        await vi.waitFor(() =>
          expect(screen.getByRole("button", { name: "Continue with keychain" })).toBeEnabled(),
        );
      } else {
        // Forgotten, the invite leaves the ways to verify to choose from again.
        expect(
          await screen.findByRole("heading", { name: "Prove you’re not a robot." }),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Invite code" })).toBeInTheDocument();
        expect(
          screen.queryByRole("heading", { name: "Pick your keychain." }),
        ).not.toBeInTheDocument();
      }
    },
  );

  it.each([
    ["the keychain", "Continue with keychain", "link", /Authorize & configure/],
    ["this browser", "Keep key in this browser", "heading", /Protect your key\./],
  ] as const)(
    "checks an invite again before %s reuses it when the check after starting over failed",
    async (_, signer, role, destination) => {
      stubCoarsePointer();
      const user = userEvent.setup();
      // This browser is chosen in a dialog that first lists its tradeoffs.
      const choose = () =>
        signer === "Continue with keychain"
          ? user.click(screen.getByRole("button", { name: signer }))
          : keepKeyInBrowser(user);
      const checkSignupToken = await abandonSubmittedInvite(user, "unknown");
      await vi.waitFor(() => expect(screen.getByRole("button", { name: signer })).toBeEnabled());
      const checks = checkSignupToken.mock.calls.length;

      checkSignupToken.mockResolvedValueOnce("used");
      await choose();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This invite has already been used.",
      );
      expect(screen.getByRole("heading", { name: "Pick your keychain." })).toBeInTheDocument();

      checkSignupToken.mockResolvedValueOnce("valid");
      await choose();
      expect(await screen.findByRole(role, { name: destination })).toBeInTheDocument();
      expect(checkSignupToken).toHaveBeenCalledTimes(checks + 2);
    },
  );

  it("does not resume or remove a submitted setup whose identity is already saved", async () => {
    saveDraft({ registrationStarted: true });
    state.catalog = {
      activePublicKeyZ32: DRAFT_KEY,
      identities: [{ publicIdentity: { publicKeyZ32: DRAFT_KEY } }],
    };
    mount(false);

    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    // Rendering only reads the draft; account setup releases it when it next opens.
    expect(expectResultOk(new LocalAccountDraftRepository().read())?.registrationStarted).toBe(
      true,
    );
  });

  it("reads the unfinished account through the collaborator", async () => {
    const readAccountDraft = vi.fn<PassportCollaborators["readAccountDraft"]>(() =>
      Result.ok({
        publicIdentity: { publicKeyZ32: DRAFT_KEY },
        invite: { homeserverPubky: HOMESERVER, signupToken: "saved-invite" },
        step: "password",
        registrationStarted: true,
      }),
    );
    mount(false, { readAccountDraft });

    // The shell resumes account creation; the setup flow reads its own saved state, here none.
    expect(
      await screen.findByRole("heading", { name: "Prove you’re not a robot." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch identity" })).not.toBeInTheDocument();
    expect(readAccountDraft).toHaveBeenCalledOnce();
  });

  it("rechecks an invite shown to Ring before Passport reuses it", async () => {
    const checkSignupToken = vi
      .fn<PassportCollaborators["checkSignupToken"]>()
      .mockResolvedValueOnce("valid")
      .mockResolvedValue("used");
    const user = userEvent.setup();
    mount(false, { checkSignupToken });
    await openAccountCreation(user, { invite: true });
    await user.type(screen.getByLabelText("Enter invite code"), "AB12-CD34-EF56");
    await screen.findByText("Invite verified with the homeserver.");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue with keychain" }));
    await user.click(screen.getByRole("button", { name: "Back" }));

    await keepKeyInBrowser(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your keychain app has already used this invite.",
    );
    expect(screen.getByRole("heading", { name: "Pick your keychain." })).toBeInTheDocument();
    expect(checkSignupToken).toHaveBeenCalledTimes(2);
  });
});

describe("provider homeserver", () => {
  const INSTANCE_WITHOUT_HOMESERVER = makeInstanceConfig({
    features: { google: false },
    homeserver: null,
  });

  function mountInstance(instance: PassportProvider) {
    const republishHomeserver = vi.fn(async (_publicKeyZ32: string, homeserverPubky: string) =>
      Result.ok(homeserverPubky),
    );
    render(
      withPassportTestProviders(
        <UniversalSignerFlow />,
        {
          createLocalIdentityController: () =>
            fakeLocalIdentityController(state, { republishHomeserver }),
          createAuthorizationController: () =>
            fakePassportAuthorizationController({ current: { status: "manual-entry" } }),
        },
        instance,
      ),
    );
    return { republishHomeserver, user: userEvent.setup() };
  }

  it("republishes a missing record to the configured provider homeserver", async () => {
    const { republishHomeserver, user } = mountInstance(makeInstanceConfig());
    await user.click(await screen.findByRole("button", { name: "Manage identity" }));
    await user.click(await screen.findByRole("button", { name: "Republish homeserver" }));
    await user.click(screen.getByRole("button", { name: /Yes, publish record/u }));

    expect(republishHomeserver).toHaveBeenCalledWith("existing-identity", HOMESERVER);
  });

  it("offers neither republishing nor Google without a provider homeserver or Google", async () => {
    const { republishHomeserver, user } = mountInstance(INSTANCE_WITHOUT_HOMESERVER);
    await user.click(await screen.findByRole("button", { name: "Manage identity" }));

    expect(await screen.findByText("No record found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Republish homeserver" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach to Google" })).not.toBeInTheDocument();
    expect(republishHomeserver).not.toHaveBeenCalled();
  });

  async function openManualInvite(instance: PassportProvider) {
    const { user } = mountInstance(instance);
    await user.click(await screen.findByRole("button", { name: "Switch identity" }));
    await user.click(screen.getByRole("button", { name: "Add identity" }));
    await user.click(screen.getByRole("button", { name: "Manage your own keys" }));
    await user.click(screen.getByRole("button", { name: "Invite code" }));
  }

  it("prefills manual invites with the configured provider homeserver", async () => {
    await openManualInvite(makeInstanceConfig());

    expect(screen.getByText(HOMESERVER)).toHaveAttribute("id", "invite-homeserver");
    expect(screen.getByRole("button", { name: "Change homeserver" })).toBeInTheDocument();
  });

  it("asks for the homeserver of a manual invite when the provider has none", async () => {
    await openManualInvite(INSTANCE_WITHOUT_HOMESERVER);

    expect(screen.getByLabelText("Homeserver public key")).toHaveValue("");
  });
});

describe("required Ring profile setup", () => {
  const RING: LocalIdentityMetadata = {
    publicIdentity: { publicKeyZ32: "ring-identity" },
    keySource: "ring",
    profileSetupRequired: true,
  };
  function disconnectedRing() {
    return {
      start: vi.fn(async () => Result.ok()),
      poll: vi.fn(() => new Promise<never>(() => undefined)),
      confirm: vi.fn(),
      authorizationUrl: () => "pubkyauth://signin?secret=passport-profile-only",
      isConnected: () => false,
      save: vi.fn(),
      dispose: vi.fn(),
    };
  }

  it("opens an app's request before Passport's own Ring request for unfinished setup", async () => {
    state.catalog = { activePublicKeyZ32: "ring-identity", identities: [RING] };
    const ring = disconnectedRing();
    const user = userEvent.setup();
    stubCoarsePointer();
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign });
    mount(true, { createRingProfileController: () => ring });

    expect(await screen.findByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Connect your keychain." })).toBeNull();
    expect(screen.queryByRole("img", { name: "Keychain connection QR code" })).toBeNull();
    expect(ring.start).not.toHaveBeenCalled();
    // The Ring identity is not offered for the request: the start page is the first screen.
    expect(screen.queryByText("Key in Pubky Ring")).toBeNull();
    expect(screen.queryByRole("button", { name: "Authorize" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Use Pubky Ring" }));
    // A phone follows the unchanged request straight to Ring.
    expect(assign).toHaveBeenCalledWith(EXACT_REQUEST);
    expect(screen.getByRole("link", { name: "Opening Pubky Ring…" })).toHaveAttribute(
      "href",
      EXACT_REQUEST,
    );
    await user.click(screen.getByRole("button", { name: "Back" }));
    // Back on the request's first step answers the app.
    expect(screen.getByRole("heading", { name: "Let’s join Pubky." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(approve).not.toHaveBeenCalled();
    expect(ring.start).not.toHaveBeenCalled();
    expect(state.catalog.identities[0]?.profileSetupRequired).toBe(true);
  });

  it("offers a reloaded Ring identity its setup without forcing the connection", async () => {
    state.catalog = { activePublicKeyZ32: "ring-identity", identities: [RING] };
    const user = userEvent.setup();
    mount(false, { createRingProfileController: disconnectedRing });

    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set up profile" }));
    expect(
      await screen.findByRole("heading", { name: "Connect your keychain." }),
    ).toBeInTheDocument();
    // Opened from the overview, Back is the one way out and returns there.
    expect(screen.queryByRole("button", { name: "Skip for now" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    // A Ring identity has no Manage to return to.
    expect(screen.queryByRole("button", { name: "Manage identity" })).not.toBeInTheDocument();
  });
});
