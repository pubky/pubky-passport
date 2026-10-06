/** @vitest-environment jsdom */

import { Result } from "better-result";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";
import { bindTestOpener, releaseTestOpener } from "@test-utils/boundOpener";
import { fakeLocalIdentityController } from "@test-utils/fakeLocalIdentityController";
import { fakePassportAuthorizationController } from "@test-utils/fakePassportAuthorizationController";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { makeInstanceConfig } from "@test-utils/instanceConfig";
import { UniversalSignerFlow } from "./universalSignerFlow";
import { mockGoogleIdentityController } from "@test-utils/mockGoogleIdentityController";

const MOCKS = {
  approve: vi.fn(),
  authorizationListener: null as null | (() => void),
  authorizationState: undefined as PassportAuthorizationViewState | undefined,
  cancel: vi.fn(),
  catalog: undefined as LocalIdentityCatalog | undefined,
  catalogListener: undefined as (() => void) | undefined,
  dispose: vi.fn(),
  select: vi.fn(),
  createAuthorizationController: vi.fn(),
};

function authorizationCollaborators() {
  return {
    createAuthorizationController: () => {
      MOCKS.createAuthorizationController();
      return fakePassportAuthorizationController(
        {
          get current() {
            return MOCKS.authorizationState;
          },
          get listener() {
            return MOCKS.authorizationListener ?? undefined;
          },
          set listener(listener) {
            MOCKS.authorizationListener = listener ?? null;
          },
        },
        {
          approve: MOCKS.approve,
          cancel: MOCKS.cancel,
          dispose: MOCKS.dispose,
          externalSignerUrl: () =>
            "pubkyauth://signin?relay=https://relay.example/inbox&secret=exact-request",
        },
      );
    },
    createLocalIdentityController: () =>
      fakeLocalIdentityController(
        {
          get catalog() {
            return MOCKS.catalog;
          },
          set catalog(catalog) {
            MOCKS.catalog = catalog;
          },
          get listener() {
            return MOCKS.catalogListener;
          },
          set listener(listener) {
            MOCKS.catalogListener = listener;
          },
        },
        { selectIdentity: MOCKS.select },
      ),
  };
}

function wrapFlow(children: ReactNode) {
  return withPassportTestProviders(children, {
    ...authorizationCollaborators(),
    createGoogleIdentityController: () =>
      mockGoogleIdentityController({
        establishIdentity: async () => {
          MOCKS.catalog = {
            activePublicKeyZ32: SECOND.publicIdentity.publicKeyZ32,
            identities: [FIRST, SECOND],
          };
          MOCKS.catalogListener?.();
          return Result.ok({
            establishmentMode: "restored" as const,
            googleAccount: SECOND.googleAccount,
            publicIdentity: SECOND.publicIdentity,
          });
        },
      }),
  });
}

const REVIEW = {
  authenticationMethod: "cookie",
  capabilities: [
    { path: "/pub/requesting.app/", read: true, write: true, scope: "specific" },
    { path: "/pub/paykit/", read: true, write: false, scope: "specific" },
  ],
  callbackHost: "requesting.app",
} as const;

const FIRST = {
  publicIdentity: { publicKeyZ32: "first-public-key" },
  profile: { name: "First User" },
  googleAccount: {
    email: "first@example.com",
    googleSubject: "google-first",
    name: "Google First",
    pictureUrl: null,
  },
};
const SECOND = {
  publicIdentity: { publicKeyZ32: "second-public-key" },
  profile: { name: "Second User" },
  googleAccount: {
    email: "second@example.com",
    googleSubject: "google-second",
    name: "Google Second",
    pictureUrl: null,
  },
};

describe("UniversalSignerFlow with an authorization request", () => {
  beforeEach(() => {
    // The app's v2 hello bound the request from the host it returns to (A39); `window.opener` is
    // reset so each test says itself whether this page is the app's popup.
    bindTestOpener("https://requesting.app");
    vi.stubGlobal("opener", null);
    MOCKS.authorizationState = { status: "review", review: REVIEW };
    MOCKS.catalog = {
      activePublicKeyZ32: FIRST.publicIdentity.publicKeyZ32,
      identities: [FIRST, SECOND],
    };
    MOCKS.approve.mockResolvedValue({ status: "granting", review: REVIEW });
    MOCKS.cancel.mockResolvedValue({ status: "cancelled", review: REVIEW });
    MOCKS.select.mockImplementation((publicKeyZ32: string) => {
      if (!MOCKS.catalog) return Result.err({ code: "storage_unavailable" as const });
      MOCKS.catalog = { ...MOCKS.catalog, activePublicKeyZ32: publicKeyZ32 };
      MOCKS.catalogListener?.();
      return Result.ok();
    });
  });

  afterEach(async () => {
    cleanup();
    releaseTestOpener();
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await Promise.resolve();
    vi.clearAllMocks();
    MOCKS.authorizationListener = null;
    MOCKS.catalogListener = undefined;
  });

  const renderFlow = () => render(wrapFlow(<UniversalSignerFlow />));
  /** A request opens on its identity list; choosing the active identity opens its review. */
  const renderReview = async () => {
    const view = renderFlow();
    await userEvent.setup().click(await screen.findByRole("button", { name: /First User/u }));
    await screen.findByRole("button", {
      name: /^(?:Authorize|Allow (?:reading|changing) all .+)$/u,
    });
    return view;
  };

  it("shows the requested permissions and active identity", async () => {
    await renderReview();

    expect(
      await screen.findByRole("heading", { name: "Signing in to requesting.app" }),
    ).toBeInTheDocument();
    const band = screen.getByRole("complementary", { name: "Signing in to requesting.app" });
    expect(band).toHaveAttribute("data-passport-context-band", "");
    expect(band).toHaveClass(
      "absolute",
      "inset-x-0",
      "top-0",
      "border-b",
      "border-brand/20",
      "bg-brand/10",
      "text-brand",
    );
    expect(band.firstElementChild).toHaveClass("min-h-[33px]", "items-center");
    const signInIcon = band.querySelector("svg");
    expect(signInIcon).toHaveAttribute("viewBox", "0 0 24 24");
    expect(signInIcon?.querySelector("path")).toHaveAttribute(
      "d",
      "M15 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H15M10 7L15 12L10 17M15 12H3",
    );
    expect(
      screen.getAllByRole("complementary", { name: "Signing in to requesting.app" }),
    ).toHaveLength(1);
    expect(screen.getByText("/pub/requesting.app/")).toBeInTheDocument();
    const permissions = screen.getByRole("list", { name: "Requested permissions" });
    expect(
      within(permissions)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "This app's own data, /pub/requesting.app/, Read & write",
      "Another app's data: “paykit”, /pub/paykit/, Read only",
    ]);
    expect(screen.getByText("First User")).toBeInTheDocument();
    expect(screen.getByText(/^Authorizing will allow/u).closest("p")).toHaveTextContent(
      "Only continue if you just started signing in to requesting.app. The app will see your public key (firs…-key) and your public profile, but not your secret key or your Google account.",
    );
    expect(
      screen.getByText(/allow requesting\.app to read and update your data/u),
    ).toBeInTheDocument();
    expect(MOCKS.createAuthorizationController).toHaveBeenCalledWith();
    // Authorize is the one action below the request; Cancel answers from the header slot, as on
    // the identity list, and nowhere else.
    const authorize = screen.getByRole("button", { name: "Authorize" });
    expect(authorize).toHaveClass("mt-auto", "md:mt-0", "w-full");
    const cancel = screen.getAllByRole("button", { name: "Cancel" });
    expect(cancel).toHaveLength(1);
    expect(cancel[0]).toHaveClass("bg-secondary");
    expect(cancel[0]!.compareDocumentPosition(screen.getByRole("heading", { level: 1 }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // Then the same "or" as the list: the start page and Pubky Ring, after Authorize.
    const or = screen.getByText("or", { exact: true });
    expect(authorize.compareDocumentPosition(or)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    for (const name of ["Use another identity", "Continue with Pubky Ring"]) {
      const other = screen.getByRole("button", { name });
      expect(other).toHaveClass("bg-secondary");
      expect(or.compareDocumentPosition(other)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it("shows the validated callback host for a grant request", async () => {
    MOCKS.authorizationState = {
      status: "review",
      review: {
        ...REVIEW,
        authenticationMethod: "grant",
        callbackHost: "trusted.example",
      },
    };

    await renderReview();

    expect(
      await screen.findByRole("heading", { name: "Signing in to trusted.example" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/allow trusted\.example to read and update your data/u),
    ).toBeInTheDocument();
  });

  it("without a hello names nobody: the label is unverified, the callback only where it returns", async () => {
    releaseTestOpener();
    MOCKS.authorizationState = {
      status: "review",
      review: {
        ...REVIEW,
        requesterName: "Trusted App",
        callbackHost: "trusted.example",
      },
    };

    await renderReview();

    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Sign-in request.");
    expect(screen.getByText(/^Name in the request:/u)).toHaveTextContent(
      "Name in the request: Trusted App (unverified)",
    );
    const band = screen.getByRole("complementary", {
      name: "Passport can’t confirm who is asking.",
    });
    expect(band).toHaveTextContent("Returns to trusted.example (unverified)");
    expect(screen.getByText(/allow the app to read and update your data/u)).toBeInTheDocument();
    expect(screen.getByText(/can’t confirm who sent this request/u)).toBeInTheDocument();
    expect(screen.queryByText(/Signing in to|^Website:/u)).not.toBeInTheDocument();
  });

  it("scales a callback host to the largest font size that fits", () => {
    const callbackHost = "gillohner.github.io";
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.tagName === "SPAN" && this.textContent === callbackHost ? 300 : 0;
      });
    const scrollWidth = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.tagName === "BDI" && this.textContent === callbackHost ? 400 : 0;
      });
    const computedStyle = vi
      .spyOn(window, "getComputedStyle")
      .mockReturnValue({ fontSize: "48px" } as CSSStyleDeclaration);

    try {
      MOCKS.authorizationState = {
        status: "review",
        review: { ...REVIEW, callbackHost },
      };

      renderFlow();

      const domain = document.querySelector<HTMLElement>("h1 bdi");
      expect(domain).not.toBeNull();
      if (!domain) throw new Error("Missing fitted requester");
      expect(domain.style.fontSize).toBe("36px");
      expect(domain.style.whiteSpace).toBe("nowrap");
      expect(domain).toHaveTextContent(callbackHost);
    } finally {
      clientWidth.mockRestore();
      scrollWidth.mockRestore();
      computedStyle.mockRestore();
    }
  });

  it("fits the requester against the heading when its inline wrapper has no width", () => {
    const callbackHost = "gillohner.github.io";
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.tagName === "H1" ? 300 : 0;
      });
    const scrollWidth = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.tagName === "BDI" && this.textContent === callbackHost ? 400 : 0;
      });
    const computedStyle = vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          display: (element as HTMLElement).tagName === "SPAN" ? "inline" : "block",
          fontSize: "48px",
        }) as CSSStyleDeclaration,
    );

    try {
      MOCKS.authorizationState = {
        status: "review",
        review: { ...REVIEW, callbackHost },
      };

      renderFlow();

      const domain = document.querySelector<HTMLElement>("h1 bdi");
      expect(domain).not.toBeNull();
      if (!domain) throw new Error("Missing fitted requester");
      expect(domain.style.fontSize).toBe("36px");
      expect(domain.style.whiteSpace).toBe("nowrap");
    } finally {
      clientWidth.mockRestore();
      scrollWidth.mockRestore();
      computedStyle.mockRestore();
    }
  });

  it("wraps rather than shrinking a callback host below the readable minimum", () => {
    const callbackHost =
      "an-extremely-long-callback-host-that-cannot-fit-at-a-readable-size.requesting.example";
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.tagName === "SPAN" && this.textContent === callbackHost ? 300 : 0;
      });
    const scrollWidth = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.tagName === "BDI" && this.textContent === callbackHost ? 600 : 0;
      });
    const computedStyle = vi
      .spyOn(window, "getComputedStyle")
      .mockReturnValue({ fontSize: "48px" } as CSSStyleDeclaration);

    try {
      MOCKS.authorizationState = {
        status: "review",
        review: { ...REVIEW, callbackHost },
      };

      renderFlow();

      const domain = document.querySelector<HTMLElement>("h1 bdi");
      expect(domain).not.toBeNull();
      if (!domain) throw new Error("Missing fitted requester");
      expect(domain).toHaveClass("break-words");
      expect(domain.style.fontSize).toBe("32px");
      expect(domain.style.whiteSpace).toBe("normal");
      expect(domain).toHaveTextContent(callbackHost);
    } finally {
      clientWidth.mockRestore();
      scrollWidth.mockRestore();
      computedStyle.mockRestore();
    }
  });

  it("warns when a request includes broad access", async () => {
    MOCKS.authorizationState = {
      status: "review",
      review: {
        ...REVIEW,
        capabilities: [{ path: "/", read: true, write: true, scope: "broad" }],
      },
    };

    await renderReview();

    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent(
      "This app asks for access to all your data, public and private.",
    );
    // A security risk, so it keeps the red surface rather than the amber warning tone.
    expect(warning).toHaveAttribute("data-tone", "error");
  });

  it("lists permissions in the requested order", async () => {
    MOCKS.authorizationState = {
      status: "review",
      review: {
        ...REVIEW,
        capabilities: [
          { path: "/pub/ordinary.app/", read: true, write: false, scope: "specific" },
          { path: "/pub/", read: true, write: false, scope: "broad" },
          { path: "/priv/vault/", read: false, write: true, scope: "specific" },
          { path: "/", read: true, write: false, scope: "broad" },
        ],
      },
    };

    await renderReview();

    const permissionHeading = await screen.findByRole("heading", {
      name: "Requested permissions",
    });
    const permissionSection = permissionHeading.closest("section");
    expect(permissionHeading).toHaveClass("leading-5");
    expect(permissionSection).toHaveClass("p-[15px]");
    expect(
      Array.from(
        permissionSection?.querySelectorAll("bdi.font-mono") ?? [],
        (path) => path.textContent,
      ),
    ).toEqual(["/pub/ordinary.app/", "/pub/", "/priv/vault/", "/"]);
  });

  it.each([
    [
      { path: "/pub/app/", read: true, write: false, scope: "specific" as const },
      /allow requesting\.app to read your data/u,
    ],
    [
      { path: "/pub/app/", read: false, write: true, scope: "specific" as const },
      /allow requesting\.app to update your data/u,
    ],
  ])("describes the requested actions accurately", async (capability, expectedText) => {
    MOCKS.authorizationState = {
      status: "review",
      review: { ...REVIEW, capabilities: [capability] },
    };

    await renderReview();

    expect(await screen.findByText(expectedText)).toBeInTheDocument();
  });

  it("states when sign-in requests no data access", async () => {
    MOCKS.authorizationState = {
      status: "review",
      review: { ...REVIEW, capabilities: [] },
    };

    await renderReview();

    expect(await screen.findByText(/does not ask for data access/u)).toBeInTheDocument();
    expect(screen.getByText("No data permissions requested.")).toBeInTheDocument();
  });

  it("names nobody in either surface for a request without callbacks or a hello", async () => {
    releaseTestOpener();
    const reviewWithoutCallback = {
      authenticationMethod: REVIEW.authenticationMethod,
      capabilities: REVIEW.capabilities,
    };
    MOCKS.authorizationState = { status: "review", review: reviewWithoutCallback };

    await renderReview();

    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Sign-in request.");
    expect(screen.getByText(/can’t confirm who sent this request/u)).toBeInTheDocument();
    const band = screen.getByRole("complementary", {
      name: "Passport can’t confirm who is asking.",
    });
    expect(band).not.toHaveTextContent(/Returns to/u);
  });

  it.each(["review", "completing"] as const)(
    "never treats x-source as the requester origin during %s",
    async (status) => {
      const review = {
        authenticationMethod: REVIEW.authenticationMethod,
        capabilities: REVIEW.capabilities,
        requesterName: "bank.example",
      };
      MOCKS.authorizationState =
        status === "completing"
          ? { status, review, outcome: "success" }
          : { status: "review", review };

      releaseTestOpener();
      renderFlow();

      // The label shows only as the request's own unverified claim; the band names nobody.
      expect(await screen.findByText(/can’t confirm who sent this request/u)).toBeInTheDocument();
      expect(screen.getByText(/^Name in the request:/u)).toHaveTextContent(
        "Name in the request: bank.example (unverified)",
      );
      const band = screen.getByRole("complementary", {
        name: "Passport can’t confirm who is asking.",
      });
      expect(band).not.toHaveTextContent(/bank\.example/u);
    },
  );

  it("shows a refusal on Cancel, never as an approval, while it goes back to the app", async () => {
    MOCKS.authorizationState = { status: "completing", review: REVIEW, outcome: "cancel" };

    renderFlow();

    expect(await screen.findByRole("button", { name: "Cancelling…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Authorize" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Completing|Returning/u })).toBeNull();
    expect(
      screen.getByRole("complementary", { name: "Signing in to requesting.app" }),
    ).toBeInTheDocument();
  });

  it("says an approval goes back to the app while completing its callback", async () => {
    MOCKS.authorizationState = { status: "completing", review: REVIEW, outcome: "success" };

    renderFlow();

    expect(await screen.findByRole("button", { name: "Returning to the app…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Returning to requesting.app…");
  });

  it.each(["preparing", "granting", "completing"] as const)(
    "disables switching and the other ways in during %s",
    async (status) => {
      await renderReview();
      act(() => {
        MOCKS.authorizationState =
          status === "completing"
            ? { status, review: REVIEW, outcome: "success" }
            : { status, review: REVIEW };
        MOCKS.authorizationListener?.();
      });
      // The review keeps its shape while the answer is on its way; nothing else can start.
      for (const name of ["Switch identity", "Use another identity", "Continue with Pubky Ring"])
        expect(screen.getByRole("button", { name })).toBeDisabled();
      expect(
        screen.queryByRole("img", { name: "Pubky authorization QR code" }),
      ).not.toBeInTheDocument();
    },
  );

  it("lists every identity, the last used first, and reviews the one chosen", async () => {
    const user = userEvent.setup();
    MOCKS.catalog = {
      activePublicKeyZ32: SECOND.publicIdentity.publicKeyZ32,
      identities: [FIRST, SECOND],
    };
    renderFlow();

    expect(
      await screen.findByRole("heading", { name: "Signing in to requesting.app" }),
    ).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Choose the identity to sign in with." });
    const rows = within(list).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Second User"),
      expect.stringContaining("First User"),
    ]);
    // Nothing is chosen for this request yet, so no row reads as pressed.
    for (const row of rows) expect(row).not.toHaveAttribute("aria-pressed");
    expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();
    expect(screen.getByText("or")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use another identity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Pubky Ring" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument();

    await user.click(rows[1]!);
    expect(MOCKS.select).toHaveBeenCalledWith(FIRST.publicIdentity.publicKeyZ32);
    expect(await screen.findByRole("button", { name: "Authorize" })).toBeEnabled();
    expect(
      within(screen.getByRole("region", { name: "Selected identity" })).getByText("First User"),
    ).toBeInTheDocument();
  });

  it("says so when an identity cannot be chosen", async () => {
    const user = userEvent.setup();
    MOCKS.select.mockReturnValue(Result.err({ code: "storage_unavailable" as const }));
    renderFlow();

    await user.click(await screen.findByRole("button", { name: /Second User/u }));

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't choose this identity.");
    expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();
  });

  it("offers Pubky Ring from the list and returns there without choosing an identity", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(await screen.findByRole("button", { name: "Continue with Pubky Ring" }));

    expect(screen.getByRole("heading", { name: "Sign in with Pubky Ring." })).toHaveFocus();
    // Without a coarse pointer the QR code shows at once; a computer cannot open the link.
    expect(screen.getByRole("img", { name: "Pubky authorization QR code" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Pubky Ring" })).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("complementary", { name: "Signing in to requesting.app" }),
    ).toHaveLength(1);
    expect(MOCKS.approve).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("list", { name: "Choose the identity to sign in with." }),
    ).toBeInTheDocument();
    expect(MOCKS.select).not.toHaveBeenCalled();
    expect(MOCKS.createAuthorizationController).toHaveBeenCalledTimes(1);
    expect(MOCKS.cancel).not.toHaveBeenCalled();
  });

  it("follows the Ring link from the press on a phone and never falls back to a QR code", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const assign = vi.fn();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(pointer: coarse)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const location = vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      assign,
    });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderFlow();
      await user.click(await screen.findByRole("button", { name: "Continue with Pubky Ring" }));

      expect(assign).toHaveBeenCalledWith(
        "pubkyauth://signin?relay=https://relay.example/inbox&secret=exact-request",
      );
      expect(screen.queryByRole("img", { name: "Pubky authorization QR code" })).toBeNull();
      expect(screen.getByRole("link", { name: "Opening Pubky Ring…" })).toBeInTheDocument();
      const link = screen.getByRole("link", { name: "Opening Pubky Ring…" });
      act(() => vi.advanceTimersByTime(2_000));
      // Ring did not open: the same button offers another try, with the same request.
      expect(screen.getByRole("link", { name: "Open Pubky Ring" })).toBe(link);
      expect(link).toHaveAttribute(
        "href",
        "pubkyauth://signin?relay=https://relay.example/inbox&secret=exact-request",
      );
      expect(screen.queryByRole("img", { name: "Pubky authorization QR code" })).toBeNull();
      expect(assign).toHaveBeenCalledOnce();
    } finally {
      location.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("shows manual entry only when no authorization request was supplied", async () => {
    MOCKS.authorizationState = { status: "manual-entry" };
    renderFlow();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Authorize an app" }));

    expect(await screen.findByRole("heading", { name: "Authorize an app." })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Invalid sign-in link." }),
    ).not.toBeInTheDocument();
  });

  it("does not silently turn a malformed authorization request into manual entry", async () => {
    MOCKS.authorizationState = { status: "invalid" };
    renderFlow();

    expect(
      await screen.findByRole("heading", { name: "Invalid sign-in link." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Authorize an app." })).not.toBeInTheDocument();
  });

  it("switches the active identity through the list without losing the request", async () => {
    const user = userEvent.setup();
    await renderReview();

    await user.click(screen.getByRole("button", { name: "Switch identity" }));
    expect(
      screen.getByRole("list", { name: "Choose the identity to sign in with." }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("complementary", { name: "Signing in to requesting.app" }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("group", { name: "Attached Google account: second@example.com" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Second User/iu }));

    await waitFor(() => expect(screen.getByText("Second User")).toBeInTheDocument());
    expect(MOCKS.select).toHaveBeenLastCalledWith(SECOND.publicIdentity.publicKeyZ32);
    expect(
      screen.getByRole("heading", { name: "Signing in to requesting.app" }),
    ).toBeInTheDocument();
    // The key keeps its own case in the review, as in the list.
    expect(screen.getByText("seco…-key")).not.toHaveClass("uppercase");
  });

  it("uses another identity from the start page without losing the request", async () => {
    const user = userEvent.setup();
    renderFlow();

    await user.click(await screen.findByRole("button", { name: "Use another identity" }));

    // The start page, still addressed to the waiting app, with every way in and Back to the list.
    // Pubky Ring stays on the list, which already offers it.
    expect(
      screen.getByRole("heading", { name: "Signing in to requesting.app" }),
    ).toBeInTheDocument();
    for (const name of ["Enter invite manually", "Import it", "Continue with Google"])
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    // One card: the Pubky Ring card is left out here.
    expect(screen.getAllByRole("region")).toEqual([
      screen.getByRole("region", { name: "Create account" }),
    ]);
    expect(screen.queryByRole("button", { name: "Continue with Pubky Ring" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in with Pubky Ring" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("complementary", { name: "Signing in to requesting.app" }),
    ).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("list", { name: "Choose the identity to sign in with." }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use another identity" }));
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    // A restore needs no confirmation screen; the review comes straight back.
    expect(await screen.findByRole("button", { name: "Authorize" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Signing in to requesting.app" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Restore complete." })).not.toBeInTheDocument();
  });

  it("without Google, the start page offers the recovery file import, and the list Pubky Ring", async () => {
    const user = userEvent.setup();
    render(
      withPassportTestProviders(
        <UniversalSignerFlow />,
        authorizationCollaborators(),
        makeInstanceConfig({ features: { google: false } }),
      ),
    );

    expect(
      await screen.findByRole("button", { name: "Continue with Pubky Ring" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use another identity" }));
    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Pubky Ring" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Import it" }));
    expect(
      await screen.findByRole("heading", { name: /Import (your )?(backup|recovery file)/iu }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("region", { name: "Create account" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("list", { name: "Choose the identity to sign in with." }),
    ).toBeInTheDocument();
  });

  it("creates an account from the start page, and Back returns there, then to the list", async () => {
    const user = userEvent.setup();
    renderFlow();

    await user.click(await screen.findByRole("button", { name: "Use another identity" }));
    // The way to verify is picked on the start page, and account creation opens on it.
    await user.click(screen.getByRole("button", { name: "Enter invite manually" }));
    expect(await screen.findByLabelText("Enter invite code")).toBeInTheDocument();
    expect(
      screen.getAllByRole("complementary", { name: "Signing in to requesting.app" }),
    ).toHaveLength(1);
    // Back from the method's first step is the start page, not a second list of methods.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("region", { name: "Create account" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.getByRole("list", { name: "Choose the identity to sign in with." }),
    ).toBeInTheDocument();
    expect(MOCKS.cancel).not.toHaveBeenCalled();
  });

  it("offers Back and Cancel when an added identity cannot be selected", async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(await screen.findByRole("button", { name: "Use another identity" }));
    MOCKS.select.mockReturnValue(Result.err({ code: "storage_unavailable" as const }));
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Identity saved." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select identity" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("heading", { name: "Signing in to requesting.app" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Switch identity" }));
    await user.click(screen.getByRole("button", { name: "Use another identity" }));
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    // Answering the app is a side action: a text action in the row under Back and Select
    // identity, not a pill that reads as a second Back.
    expect(cancel).toHaveClass("underline");
    expect(cancel).not.toHaveClass("h-15");
    expect(cancel.closest('[data-slot="tertiary-actions"]')).not.toBeNull();
    await user.click(cancel);
    expect(MOCKS.cancel).toHaveBeenCalledOnce();
    expect(MOCKS.approve).not.toHaveBeenCalled();
  });

  it("shows the start page and then Pubky Ring in its card when no identity is saved", async () => {
    MOCKS.catalog = { activePublicKeyZ32: null, identities: [] };
    const user = userEvent.setup();
    renderFlow();

    expect(
      await screen.findByRole("heading", { name: "Signing in to requesting.app" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "Signing in to requesting.app" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch identity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use another identity" })).not.toBeInTheDocument();
    // Two cards, creating an account first, and the recovery file as a quiet link below them.
    const create = screen.getByRole("region", { name: "Create account" });
    expect(
      within(create).getByRole("button", { name: "Continue with Google" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import it" })).toBeInTheDocument();
    const ring = within(screen.getByRole("region", { name: "Pubky Ring" })).getByRole("button", {
      name: "Continue with Pubky Ring",
    });
    expect(ring).toHaveClass("bg-secondary");
    expect(create.compareDocumentPosition(ring)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();

    // Ring gets the request unchanged, and Back comes back to the start page.
    await user.click(ring);
    expect(screen.getByRole("heading", { name: "Sign in with Pubky Ring." })).toHaveFocus();
    expect(screen.getByRole("img", { name: "Pubky authorization QR code" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("region", { name: "Create account" })).toBeInTheDocument();
    expect(MOCKS.approve).not.toHaveBeenCalled();
    expect(MOCKS.cancel).not.toHaveBeenCalled();
  });

  it("returns account creation to the start page when no identity is saved", async () => {
    MOCKS.catalog = { activePublicKeyZ32: null, identities: [] };
    const user = userEvent.setup();
    renderFlow();

    await user.click(await screen.findByRole("button", { name: "Enter invite manually" }));
    expect(await screen.findByLabelText("Enter invite code")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("heading", { name: "Signing in to requesting.app" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("shows neutral context during setup when the request has no callback host", async () => {
    MOCKS.authorizationState = {
      status: "review",
      review: {
        authenticationMethod: REVIEW.authenticationMethod,
        capabilities: REVIEW.capabilities,
        requesterName: "Source Only App",
      },
    };
    MOCKS.catalog = { activePublicKeyZ32: null, identities: [] };
    releaseTestOpener();

    renderFlow();

    // The app's own label is never who asks: without a hello it is an unverified claim.
    expect(await screen.findByText(/^Name in the request:/u)).toHaveTextContent(
      "Name in the request: Source Only App (unverified)",
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Sign-in request.");
    // The start page says it through its band and heading; the notice waits for the review.
    expect(
      screen.getByRole("complementary", { name: "Passport can’t confirm who is asking." }),
    ).not.toHaveTextContent(/Source Only App/u);
  });

  it("waits for the establishment flow after the first identity enters the catalog", async () => {
    const user = userEvent.setup();
    MOCKS.catalog = { activePublicKeyZ32: null, identities: [] };
    renderFlow();
    await screen.findByRole("region", { name: "Create account" });

    MOCKS.catalog = { activePublicKeyZ32: FIRST.publicIdentity.publicKeyZ32, identities: [FIRST] };
    act(() => {
      MOCKS.catalogListener?.();
    });

    // The start page stays for the flow that saved the identity; the list does not replace it.
    expect(screen.getByRole("region", { name: "Create account" })).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Authorize" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    // A restore needs no confirmation screen; the review comes straight back.
    expect(await screen.findByRole("button", { name: "Authorize" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Signing in to requesting.app" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Restore complete." })).not.toBeInTheDocument();
  });

  it("offers Back to the list when an identity is saved elsewhere during the first step", async () => {
    const user = userEvent.setup();
    MOCKS.catalog = { activePublicKeyZ32: null, identities: [] };
    renderFlow();
    await screen.findByRole("region", { name: "Create account" });
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();

    // Saved by another tab, with no addition flow open here.
    MOCKS.catalog = { activePublicKeyZ32: FIRST.publicIdentity.publicKeyZ32, identities: [FIRST] };
    act(() => {
      MOCKS.catalogListener?.();
    });

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: /First User/u })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use another identity" })).toBeInTheDocument();
    expect(MOCKS.cancel).not.toHaveBeenCalled();
  });

  it("cancels authorization from first-identity setup", async () => {
    const user = userEvent.setup();
    MOCKS.catalog = { activePublicKeyZ32: null, identities: [] };
    renderFlow();

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(MOCKS.cancel).toHaveBeenCalledOnce();
  });

  it("cancels authorization when leaving an unavailable identity catalog", async () => {
    const user = userEvent.setup();
    MOCKS.catalog = undefined;
    MOCKS.cancel.mockImplementation(async () => {
      MOCKS.authorizationState = { status: "cancelled", review: REVIEW };
      MOCKS.authorizationListener?.();
      return MOCKS.authorizationState;
    });
    renderFlow();

    expect(
      screen.getByRole("complementary", { name: "Signing in to requesting.app" }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(MOCKS.cancel).toHaveBeenCalledOnce();
    expect(MOCKS.approve).not.toHaveBeenCalled();
    // The outcome replaces the storage screen instead of hiding behind it.
    expect(await screen.findByRole("heading", { name: "Sign-in cancelled." })).toBeInTheDocument();
    expect(screen.queryByText(/blocking Passport's storage/u)).not.toBeInTheDocument();
  });

  it.each([
    [{ status: "invalid" }, "Invalid sign-in link."],
    [{ status: "expired" }, "Request expired."],
    [{ status: "approved", review: REVIEW }, "Signed in to requesting.app"],
    [{ status: "failed", review: REVIEW, reason: "delivery" }, "Couldn't reach requesting.app"],
  ] as const)(
    "shows the %o state even when the identity catalog is unavailable",
    async (state, heading) => {
      MOCKS.catalog = undefined;
      MOCKS.authorizationState = state;
      renderFlow();

      expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
      expect(screen.queryByText(/blocking Passport's storage/u)).not.toBeInTheDocument();
    },
  );

  it("keeps an approval in progress visible when the identity catalog becomes unavailable", async () => {
    MOCKS.authorizationState = { status: "granting", review: REVIEW };
    renderFlow();
    expect(await screen.findByRole("button", { name: "Signing in…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    act(() => {
      MOCKS.catalog = undefined;
      MOCKS.catalogListener?.();
    });

    expect(screen.getByRole("button", { name: "Signing in…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    // Without the catalog there is nothing to switch to or add.
    expect(screen.queryByRole("button", { name: "Switch identity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use another identity" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "Signing in to requesting.app" }),
    ).toBeInTheDocument();
  });

  it("asks the browser to confirm leaving while the request waits, and not once it ended", async () => {
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    renderFlow();
    await screen.findByRole("heading", { name: "Signing in to requesting.app" });

    expect(leave()).toBe(true);
    act(() => {
      MOCKS.authorizationState = { status: "cancelled", review: REVIEW };
      MOCKS.authorizationListener?.();
    });
    expect(leave()).toBe(false);
  });

  it("authorizes with the selected identity", async () => {
    const user = userEvent.setup();
    await renderReview();

    await user.click(screen.getByRole("button", { name: "Authorize" }));

    expect(MOCKS.approve).toHaveBeenCalledWith(FIRST.publicIdentity.publicKeyZ32);
  });

  it("survives StrictMode replay and keeps the request until the page is left", async () => {
    const rendered = render(<StrictMode>{wrapFlow(<UniversalSignerFlow />)}</StrictMode>);
    await screen.findByRole("heading", { name: "Signing in to requesting.app" });
    await Promise.resolve();
    expect(MOCKS.dispose).not.toHaveBeenCalled();

    rendered.unmount();
    expect(MOCKS.dispose).not.toHaveBeenCalled();

    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await waitFor(() => expect(MOCKS.dispose).toHaveBeenCalledOnce());
  });

  it.each([
    [
      { status: "approved", review: REVIEW },
      "Signed in to requesting.app",
      "Passport sent your approval as First User. You can go back to requesting.app now.",
    ],
    [
      { status: "cancelled", review: REVIEW },
      "Sign-in cancelled.",
      "Nothing was shared with requesting.app.",
    ],
    [
      { status: "failed", review: REVIEW, reason: "delivery" },
      "Couldn't reach requesting.app",
      "Your approval didn't reach requesting.app.",
    ],
    [
      { status: "failed", review: REVIEW, reason: "identity" },
      "Couldn't use First User.",
      "Passport couldn't unlock the key of First User in this browser.",
    ],
  ] as const)(
    "renders the safe local %o terminal state, naming the app",
    async (state, heading, message) => {
      MOCKS.authorizationState = state;
      renderFlow();

      expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
      expect(screen.getByText(message)).toBeInTheDocument();
      // The band still names the website the request came from.
      expect(
        screen.getByRole("complementary", { name: "Sign-in request from requesting.app" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Go to Passport" })).toBeInTheDocument();
    },
  );
});
