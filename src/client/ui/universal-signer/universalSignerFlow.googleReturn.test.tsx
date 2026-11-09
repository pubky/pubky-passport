/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeLocalIdentityController } from "@test-utils/fakeLocalIdentityController";
import { fakePassportAuthorizationController } from "@test-utils/fakePassportAuthorizationController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { mockGoogleIdentityController } from "@test-utils/mockGoogleIdentityController";
import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";
import { takeAuthorizeFromIdentity } from "@/client/logic/universal-signer/authorizeFromIdentity";
import type { PassportCollaborators } from "@/client/ui/passportCollaborators";
import { UniversalSignerFlow } from "./universalSignerFlow";

const REVIEW = {
  authenticationMethod: "cookie",
  capabilities: [{ path: "/pub/requesting.app/", read: true, write: true, scope: "specific" }],
  callbackHost: "requesting.app",
} as const;
const PREVIOUS = { publicIdentity: { publicKeyZ32: "previous-public-key" } };
const GOOGLE = {
  publicIdentity: { publicKeyZ32: "google-public-key" },
  googleAccount: {
    email: "restored@example.com",
    googleSubject: "google-restored",
    name: "Restored User",
    pictureUrl: null,
  },
};

type Establish = NonNullable<
  NonNullable<Parameters<typeof mockGoogleIdentityController>[0]>["establishIdentity"]
>;

let state: { catalog: LocalIdentityCatalog; listener?: (() => void) | undefined };
const approve = vi.fn();
const cancel = vi.fn();
const returnToAuthorization = vi.fn(() => true);
const createGoogleIdentityController =
  vi.fn<PassportCollaborators["createGoogleIdentityController"]>();

/** The page Google returned to: the request resumed there, for the Google sign-in only. */
function mountReturnPage(
  establishIdentity: Establish,
  authorization: PassportAuthorizationViewState = { status: "review", review: REVIEW },
) {
  createGoogleIdentityController.mockImplementation(() =>
    mockGoogleIdentityController({ establishIdentity }),
  );
  return render(
    withPassportTestProviders(<UniversalSignerFlow />, {
      createAuthorizationController: () =>
        fakePassportAuthorizationController({ current: authorization }, { approve, cancel }),
      createGoogleIdentityController,
      createLocalIdentityController: () => fakeLocalIdentityController(state),
      googleRedirect: { isReturn: () => true, returnToAuthorization },
    }),
  );
}

/** What the Google lifecycle does on success: the identity is saved, then reported. */
function establishes(mode: "restored" | "created"): Establish {
  return async () => {
    state.catalog = {
      // Deliberately leave the older selection active: completion must select the new identity.
      activePublicKeyZ32: state.catalog.activePublicKeyZ32,
      identities: [...state.catalog.identities, GOOGLE],
    };
    state.listener?.();
    return mode === "restored"
      ? Result.ok({
          establishmentMode: "restored" as const,
          googleAccount: GOOGLE.googleAccount,
          publicIdentity: GOOGLE.publicIdentity,
        })
      : Result.ok({
          establishmentMode: "created" as const,
          googleAccount: GOOGLE.googleAccount,
          publicIdentity: GOOGLE.publicIdentity,
          visibleRecoveryCopyStatus: "created" as const,
        });
  };
}

beforeEach(() => {
  state = { catalog: { activePublicKeyZ32: null, identities: [] } };
  returnToAuthorization.mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("the page Google returned to for a request's sign-in", () => {
  it.each([
    ["nothing saved before", null],
    ["another identity saved before", PREVIOUS],
  ] as const)(
    "finishes the Google sign-in by itself and returns to the request's page, with %s",
    async (_case, previous) => {
      if (previous)
        state.catalog = {
          activePublicKeyZ32: previous.publicIdentity.publicKeyZ32,
          identities: [previous],
        };
      mountReturnPage(establishes("restored"));

      // No second press, and the controller is the one that can take Google's answer here.
      await waitFor(() => expect(returnToAuthorization).toHaveBeenCalledOnce());
      expect(createGoogleIdentityController).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        true,
      );
      // The request is reviewed where it entered, on the identity Google just set up: this page
      // never showed the start page, the list or the review.
      expect(takeAuthorizeFromIdentity()).toBe(GOOGLE.publicIdentity.publicKeyZ32);
      expect(state.catalog.activePublicKeyZ32).toBe(GOOGLE.publicIdentity.publicKeyZ32);
      expect(screen.getByRole("main", { name: "Returning to the sign-in" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Sovereign & Secure" })).not.toBeInTheDocument();
      expect(screen.queryByRole("list", { name: /identity/u })).not.toBeInTheDocument();
      expect(approve).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
    },
  );

  it("says a new account's backup is ready, then returns instead of reviewing here", async () => {
    mountReturnPage(establishes("created"));

    const proceed = await screen.findByRole("button", { name: /^Continue/u });
    expect(returnToAuthorization).not.toHaveBeenCalled();
    await userEvent.setup().click(proceed);
    await waitFor(() => expect(returnToAuthorization).toHaveBeenCalledOnce());
    expect(takeAuthorizeFromIdentity()).toBe(GOOGLE.publicIdentity.publicKeyZ32);
    expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();
  });

  it("offers Try again and Back after a denial, and Back returns to the request's page", async () => {
    const establishIdentity = vi.fn(async () =>
      Result.err({ code: "google_authorization_denied" as const }),
    );
    mountReturnPage(establishIdentity);

    const back = await screen.findByRole("button", { name: "Back" });
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(establishIdentity).toHaveBeenCalledOnce();
    expect(returnToAuthorization).not.toHaveBeenCalled();
    await userEvent.setup().click(back);
    expect(returnToAuthorization).toHaveBeenCalledOnce();
    // Turning back names no identity to review, and the start page is not shown on this page.
    expect(takeAuthorizeFromIdentity()).toBeUndefined();
    expect(screen.queryByRole("region", { name: "Sovereign & Secure" })).not.toBeInTheDocument();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("shows why it cannot continue when the saved request is unusable, without starting Google", async () => {
    const establishIdentity = vi.fn(async () =>
      Result.err({ code: "authorization_failed" as const }),
    );
    mountReturnPage(establishIdentity, { status: "expired" });

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/expired/iu);
    expect(establishIdentity).not.toHaveBeenCalled();
    expect(returnToAuthorization).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();
  });

  it("goes to Passport's home when the request is gone by the time the sign-in finishes", async () => {
    returnToAuthorization.mockReturnValue(false);
    const replace = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, replace });
    mountReturnPage(establishes("restored"));

    await waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith("/"));
    expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();
  });
});

describe("a request's start page, before Google", () => {
  it("opens Google's own window on Continue with Google, and never by itself", async () => {
    const establishIdentity = vi.fn(() => new Promise<never>(() => undefined));
    createGoogleIdentityController.mockImplementation(() =>
      mockGoogleIdentityController({ establishIdentity }),
    );
    render(
      withPassportTestProviders(<UniversalSignerFlow />, {
        createAuthorizationController: () =>
          fakePassportAuthorizationController(
            { current: { status: "review", review: REVIEW } },
            { approve, cancel },
          ),
        createGoogleIdentityController,
        createLocalIdentityController: () => fakeLocalIdentityController(state),
      }),
    );

    // The start page offers every way in; nothing leaves for Google until the person asks. A
    // cookie request goes to Pubky Ring alone.
    const google = await screen.findByRole("button", { name: "Continue with Google" });
    expect(screen.getByRole("button", { name: "Use Pubky Ring" })).toBeInTheDocument();
    expect(establishIdentity).not.toHaveBeenCalled();
    await userEvent.setup().click(google);
    expect(establishIdentity).toHaveBeenCalledOnce();
    expect(createGoogleIdentityController).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      true,
    );
    // The pop-up is the default: the page waits beside it and does not leave for Google.
    expect(screen.getByRole("button", { name: "Show Google’s window" })).toBeInTheDocument();
    expect(screen.queryByRole("main", { name: "Continuing with Google" })).not.toBeInTheDocument();
    expect(returnToAuthorization).not.toHaveBeenCalled();
  });

  it("opens on the Google sign-in alone for an app's own Continue with Google, and waits for the press", async () => {
    const establishIdentity = vi.fn(() => new Promise<never>(() => undefined));
    createGoogleIdentityController.mockImplementation(() =>
      mockGoogleIdentityController({ establishIdentity }),
    );
    render(
      withPassportTestProviders(<UniversalSignerFlow />, {
        createAuthorizationController: () =>
          fakePassportAuthorizationController(
            { current: { status: "review", review: REVIEW, entry: "google" } },
            { approve, cancel },
          ),
        createGoogleIdentityController,
        createLocalIdentityController: () => fakeLocalIdentityController(state),
      }),
    );

    expect(await screen.findByRole("heading", { level: 1 })).toHaveAccessibleName(
      "Continue with Google.",
    );
    // Google's window needs a press in this one: nothing starts by itself.
    expect(screen.queryByRole("region", { name: "Sovereign & Secure" })).not.toBeInTheDocument();
    expect(establishIdentity).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(establishIdentity).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Show Google’s window" })).toBeInTheDocument();
    expect(returnToAuthorization).not.toHaveBeenCalled();
  });
});
