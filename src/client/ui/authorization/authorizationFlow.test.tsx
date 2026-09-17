/** @vitest-environment jsdom */

import { Result } from "better-result";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PassportAuthorizationViewState } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";
import { fakeLocalIdentityController } from "../../../../test-utils/fakeLocalIdentityController";
import { fakePassportAuthorizationController } from "../../../../test-utils/fakePassportAuthorizationController";
import { withPassportTestProviders } from "../../../../test-utils/googleIdentityConfiguration";
import { AuthorizationFlow } from "./authorizationFlow";

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

function IdentitySetupStub({
  forAuthorization,
  onBack,
  onComplete,
}: {
  forAuthorization?: boolean;
  onBack?: () => void;
  onComplete: () => void;
}) {
  return (
    <main>
      <h1>Add identity</h1>
      {forAuthorization ? <p>Authorization identity setup</p> : null}
      <button
        onClick={() => {
          MOCKS.catalogListener?.();
          onComplete();
        }}
        type="button"
      >
        Complete identity setup
      </button>
      {onBack ? (
        <button onClick={onBack} type="button">
          Back
        </button>
      ) : null}
    </main>
  );
}

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
    IdentitySetup: IdentitySetupStub,
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
  googleAccount: {
    email: "first@example.com",
    googleSubject: "google-first",
    name: "First User",
    pictureUrl: null,
  },
};
const SECOND = {
  publicIdentity: { publicKeyZ32: "second-public-key" },
  googleAccount: {
    email: "second@example.com",
    googleSubject: "google-second",
    name: "Second User",
    pictureUrl: null,
  },
};

describe("AuthorizationFlow", () => {
  beforeEach(() => {
    MOCKS.authorizationState = { status: "review", review: REVIEW };
    MOCKS.catalog = {
      activePublicKeyZ32: FIRST.publicIdentity.publicKeyZ32,
      identities: [FIRST, SECOND],
    };
    MOCKS.approve.mockResolvedValue({ status: "granting", review: REVIEW });
    MOCKS.cancel.mockResolvedValue({ status: "cancelled" });
    MOCKS.select.mockImplementation((publicKeyZ32: string) => {
      if (!MOCKS.catalog) return Result.err({ code: "storage_unavailable" as const });
      MOCKS.catalog = { ...MOCKS.catalog, activePublicKeyZ32: publicKeyZ32 };
      MOCKS.catalogListener?.();
      return Result.ok();
    });
  });

  afterEach(async () => {
    cleanup();
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await Promise.resolve();
    vi.clearAllMocks();
    MOCKS.authorizationListener = null;
    MOCKS.catalogListener = undefined;
  });

  const renderFlow = () => render(wrapFlow(<AuthorizationFlow />));

  it("shows the requested permissions and active identity", async () => {
    renderFlow();

    expect(
      await screen.findByRole("heading", { name: "Sign in to requesting.app" }),
    ).toBeInTheDocument();
    const band = screen.getByLabelText("Signing in to requesting.app");
    expect(band).toHaveAttribute("data-passport-context-band", "");
    expect(band).toHaveClass(
      "absolute",
      "inset-x-0",
      "top-0",
      "h-[var(--passport-context-band-height)]",
      "border-brand/20",
      "bg-brand/10",
      "text-brand",
    );
    const signInIcon = band.querySelector("svg");
    expect(signInIcon).toHaveAttribute("viewBox", "0 0 24 24");
    expect(signInIcon?.querySelector("path")).toHaveAttribute(
      "d",
      "M15 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H15M10 7L15 12L10 17M15 12H3",
    );
    expect(screen.getAllByLabelText("Signing in to requesting.app")).toHaveLength(1);
    expect(screen.getByText("/pub/requesting.app/")).toBeInTheDocument();
    expect(screen.getByText("Read,write").parentElement).toHaveClass("min-h-5", "items-center");
    expect(screen.getByText("First User")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Make sure you trust this service, browser, or device before authorizing with your pubky.",
        { exact: false },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/allow requesting\.app to read and update your data/u),
    ).toBeInTheDocument();
    expect(MOCKS.createAuthorizationController).toHaveBeenCalledWith();
    expect(screen.getByRole("button", { name: "Cancel" }).closest(".grid")).toHaveClass(
      "mt-auto",
      "md:mt-0",
    );
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

    renderFlow();

    expect(
      await screen.findByRole("heading", { name: "Sign in to trusted.example" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/allow trusted\.example to read and update your data/u),
    ).toBeInTheDocument();
  });

  it("uses x-source for the title and the validated callback host for the context band", async () => {
    MOCKS.authorizationState = {
      status: "review",
      review: {
        ...REVIEW,
        requesterName: "Trusted App",
        callbackHost: "trusted.example",
      },
    };

    renderFlow();

    expect(
      await screen.findByRole("heading", { name: "Sign in to Trusted App" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Signing in to trusted.example")).toBeInTheDocument();
    expect(screen.getByText(/allow Trusted App to read and update your data/u)).toBeInTheDocument();
    expect(screen.queryByLabelText("Signing in to Trusted App")).not.toBeInTheDocument();
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

    renderFlow();

    expect(await screen.findByRole("alert")).toHaveTextContent(/broad access/u);
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

    renderFlow();

    const permissionHeading = await screen.findByRole("heading", {
      name: "Requested permissions",
    });
    const permissionSection = permissionHeading.closest("section");
    expect(permissionHeading).toHaveClass("leading-5");
    expect(permissionSection).toHaveClass("p-[15px]");
    expect(
      Array.from(permissionSection?.querySelectorAll("bdi") ?? [], (path) => path.textContent),
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

    renderFlow();

    expect(await screen.findByText(expectedText)).toBeInTheDocument();
  });

  it("states when sign-in requests no data access", async () => {
    MOCKS.authorizationState = {
      status: "review",
      review: { ...REVIEW, capabilities: [] },
    };

    renderFlow();

    expect(await screen.findByText(/does not ask for data access/u)).toBeInTheDocument();
    expect(screen.getByText("No data permissions requested.")).toBeInTheDocument();
  });

  it("uses a neutral requester label when no callback host exists", async () => {
    const reviewWithoutCallback = {
      authenticationMethod: REVIEW.authenticationMethod,
      capabilities: REVIEW.capabilities,
    };
    MOCKS.authorizationState = { status: "review", review: reviewWithoutCallback };

    renderFlow();

    expect(
      await screen.findByRole("heading", { name: "Sign in to this service" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/allow this service to read and update your data/u),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-passport-context-band]")).not.toBeInTheDocument();
  });

  it("uses x-source for the title but requires a callback origin for the band", async () => {
    MOCKS.authorizationState = {
      status: "review",
      review: {
        authenticationMethod: REVIEW.authenticationMethod,
        capabilities: REVIEW.capabilities,
        requesterName: "Source Only App",
      },
    };

    renderFlow();

    expect(
      await screen.findByRole("heading", { name: "Sign in to Source Only App" }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-passport-context-band]")).not.toBeInTheDocument();
  });

  it("uses a neutral progress label while completing the callback", async () => {
    MOCKS.authorizationState = { status: "completing", review: REVIEW };

    renderFlow();

    expect(await screen.findByRole("button", { name: "Completing…" })).toBeDisabled();
    expect(screen.getByLabelText("Signing in to requesting.app")).toBeInTheDocument();
  });

  it("shows manual entry only when no authorization request was supplied", async () => {
    MOCKS.authorizationState = { status: "manual-entry" };
    renderFlow();

    expect(
      await screen.findByRole("heading", { name: "Authorize a service." }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Invalid authorization request" }),
    ).not.toBeInTheDocument();
  });

  it("does not silently turn a malformed authorization request into manual entry", async () => {
    MOCKS.authorizationState = { status: "invalid" };
    renderFlow();

    expect(
      await screen.findByRole("heading", { name: "Invalid authorization request" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Authorize a service." })).not.toBeInTheDocument();
  });

  it("switches the active identity without losing the authorization review", async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByRole("heading", { name: "Sign in to requesting.app" });

    await user.click(screen.getByRole("button", { name: "Switch" }));
    expect(screen.getByRole("heading", { name: "Switch identity." })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Signing in to requesting.app")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /use other identity/iu })).toBeInTheDocument();
    expect(screen.getByText("second@example.com")).toHaveClass("lowercase");
    await user.click(screen.getByRole("button", { name: /Second User/iu }));

    await waitFor(() => expect(screen.getByText("Second User")).toBeInTheDocument());
    expect(MOCKS.select).toHaveBeenCalledWith(SECOND.publicIdentity.publicKeyZ32);
    expect(screen.getByRole("heading", { name: "Sign in to requesting.app" })).toBeInTheDocument();
    expect(screen.getByText("seco...-key")).toHaveClass("uppercase");
  });

  it("adds an identity through the normal sign-in flow without losing the review", async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByRole("heading", { name: "Sign in to requesting.app" });

    await user.click(screen.getByRole("button", { name: "Switch" }));
    await user.click(screen.getByRole("button", { name: /use other identity/iu }));

    expect(screen.getByRole("heading", { name: "Add identity" })).toBeInTheDocument();
    expect(screen.getByText("Authorization identity setup")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Signing in to requesting.app")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Complete identity setup" }));
    expect(screen.getByRole("heading", { name: "Sign in to requesting.app" })).toBeInTheDocument();
  });

  it("opens Google identity setup immediately when no local identity exists", async () => {
    MOCKS.catalog = { activePublicKeyZ32: null, identities: [] };
    renderFlow();

    expect(await screen.findByRole("heading", { name: "Add identity" })).toBeInTheDocument();
    expect(screen.getByLabelText("Signing in to requesting.app")).toBeInTheDocument();
    expect(screen.queryByText("No local identity available")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("does not show a setup band when the request has no callback host", async () => {
    MOCKS.authorizationState = {
      status: "review",
      review: {
        authenticationMethod: REVIEW.authenticationMethod,
        capabilities: REVIEW.capabilities,
      },
    };
    MOCKS.catalog = { activePublicKeyZ32: null, identities: [] };

    renderFlow();

    expect(await screen.findByRole("heading", { name: "Add identity" })).toBeInTheDocument();
    expect(document.querySelector("[data-passport-context-band]")).not.toBeInTheDocument();
  });

  it("waits for explicit completion after the first identity enters the catalog", async () => {
    const user = userEvent.setup();
    MOCKS.catalog = { activePublicKeyZ32: null, identities: [] };
    renderFlow();
    await screen.findByRole("heading", { name: "Add identity" });

    MOCKS.catalog = { activePublicKeyZ32: FIRST.publicIdentity.publicKeyZ32, identities: [FIRST] };

    expect(screen.getByRole("heading", { name: "Add identity" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Sign in to requesting.app" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Complete identity setup" }));
    expect(screen.getByRole("heading", { name: "Sign in to requesting.app" })).toBeInTheDocument();
  });

  it("cancels authorization from first-identity setup", async () => {
    const user = userEvent.setup();
    MOCKS.catalog = { activePublicKeyZ32: null, identities: [] };
    renderFlow();

    await user.click(await screen.findByRole("button", { name: "Back" }));

    expect(MOCKS.cancel).toHaveBeenCalledOnce();
  });

  it("cancels authorization when leaving an unavailable identity catalog", async () => {
    const user = userEvent.setup();
    MOCKS.catalog = undefined;
    renderFlow();

    expect(screen.getByLabelText("Signing in to requesting.app")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Back" }));

    expect(MOCKS.cancel).toHaveBeenCalledOnce();
    expect(MOCKS.approve).not.toHaveBeenCalled();
  });

  it("authorizes with the selected identity", async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByRole("heading", { name: "Sign in to requesting.app" });

    await user.click(screen.getByRole("button", { name: "Authorize" }));

    expect(MOCKS.approve).toHaveBeenCalledWith(FIRST.publicIdentity.publicKeyZ32);
  });

  it("survives StrictMode replay and keeps the request until the page is left", async () => {
    const rendered = render(<StrictMode>{wrapFlow(<AuthorizationFlow />)}</StrictMode>);
    await screen.findByRole("heading", { name: "Sign in to requesting.app" });
    await Promise.resolve();
    expect(MOCKS.dispose).not.toHaveBeenCalled();

    rendered.unmount();
    expect(MOCKS.dispose).not.toHaveBeenCalled();

    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await waitFor(() => expect(MOCKS.dispose).toHaveBeenCalledOnce());
  });

  it.each([
    [
      "approved",
      "Authorization complete.",
      "Continue",
      "You can return to the app or device where you started.",
    ],
    ["cancelled", "Authorization cancelled.", "Back", "No authorization was granted."],
    [
      "failed",
      "Authorization failed.",
      "Back",
      "Passport could not authorize this request with the selected identity.",
    ],
  ] as const)(
    "renders the safe local %s terminal state",
    async (status, heading, action, message) => {
      MOCKS.authorizationState = { status };
      renderFlow();

      expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
    },
  );
});
