/** @vitest-environment jsdom */

import { Result } from "better-result";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PassportAuthorizationViewState } from "../../logic/authorization/flow/PassportAuthorizationController";
import type { LocalIdentityCatalog } from "../../logic/local-identity/localIdentityModels";
import { AuthorizationFlow } from "./authorizationFlow";

const MOCKS = vi.hoisted(() => ({
  approve: vi.fn(),
  authorizationListener: null as null | (() => void),
  authorizationState: undefined as PassportAuthorizationViewState | undefined,
  cancel: vi.fn(),
  catalog: undefined as LocalIdentityCatalog | undefined,
  catalogListener: undefined as (() => void) | undefined,
  dispose: vi.fn(),
  select: vi.fn(),
  createAuthorizationController: vi.fn(),
}));

vi.mock("../../logic/authorization/flow/PassportAuthorizationController", () => ({
  PassportAuthorizationController: class {
    static fromBrowser() {
      return new this();
    }

    constructor(...args: unknown[]) {
      MOCKS.createAuthorizationController(...args);
    }

    approve = MOCKS.approve;
    cancel = MOCKS.cancel;
    dispose = MOCKS.dispose;
    getState = () => MOCKS.authorizationState;
    subscribe = (listener: () => void) => {
      MOCKS.authorizationListener = listener;
      return () => { MOCKS.authorizationListener = null; };
    };
  },
}));

vi.mock("../../logic/local-identity/LocalIdentityController", () => ({
  createLocalIdentityService: () => ({
    listIdentities: () => MOCKS.catalog
      ? Result.ok(MOCKS.catalog)
      : Result.err({ code: "storage_unavailable" as const }),
    selectIdentity: MOCKS.select,
    subscribeToIdentityChanges: (listener: () => void) => {
      MOCKS.catalogListener = listener;
      return () => { MOCKS.catalogListener = undefined; };
    },
  }),
}));

vi.mock("../onboarding/identityEstablishmentFlow", () => ({
  IdentityEstablishmentFlow: ({ onBack, onComplete }: { onBack?: () => void; onComplete: () => void }) => (
    <main>
      <h1>Add identity</h1>
      <button onClick={() => { MOCKS.catalogListener?.(); onComplete(); }} type="button">Complete identity setup</button>
      {onBack ? <button onClick={onBack} type="button">Back</button> : null}
    </main>
  ),
}));

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
  googleAccount: { email: "first@example.com", googleSubject: "google-first", name: "First User", pictureUrl: null },
};
const SECOND = {
  publicIdentity: { publicKeyZ32: "second-public-key" },
  googleAccount: { email: "second@example.com", googleSubject: "google-second", name: "Second User", pictureUrl: null },
};

describe("AuthorizationFlow", () => {
  beforeEach(() => {
    MOCKS.authorizationState = { status: "review", review: REVIEW };
    MOCKS.catalog = { activePublicKeyZ32: FIRST.publicIdentity.publicKeyZ32, identities: [FIRST, SECOND] };
    MOCKS.approve.mockResolvedValue({ status: "approving", review: REVIEW });
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
    await Promise.resolve();
    vi.clearAllMocks();
    MOCKS.authorizationListener = null;
    MOCKS.catalogListener = undefined;
  });

  const renderFlow = () => render(<AuthorizationFlow />);

  it("shows the requested permissions and active identity", async () => {
    renderFlow();

    expect(await screen.findByRole("heading", { name: "Sign in to requesting.app" })).toBeInTheDocument();
    expect(screen.getByText("/pub/requesting.app/")).toBeInTheDocument();
    expect(screen.getByText("Read & write")).toBeInTheDocument();
    expect(screen.getByText("First User")).toBeInTheDocument();
    expect(screen.getByText("Make sure you trust this service, browser, or device before authorizing with your pubky.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/allow requesting\.app to read and update your data/u)).toBeInTheDocument();
    expect(MOCKS.createAuthorizationController).toHaveBeenCalledWith();
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

    expect(await screen.findByRole("heading", { name: "Sign in to trusted.example" })).toBeInTheDocument();
    expect(screen.getByText(/allow trusted\.example to read and update your data/u)).toBeInTheDocument();
  });

  it("wraps a long callback host without changing its displayed value", async () => {
    const callbackHost = "a-very-long-subdomain-that-must-wrap-without-being-truncated.requesting.example";
    MOCKS.authorizationState = {
      status: "review",
      review: { ...REVIEW, callbackHost },
    };

    renderFlow();

    const domain = await screen.findByText(callbackHost);
    expect(domain).toHaveClass("break-words");
    expect(domain).toHaveTextContent(callbackHost);
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

    const permissionSection = (await screen.findByRole("heading", { name: "Requested permissions" })).closest("section");
    expect(Array.from(permissionSection?.querySelectorAll("bdi") ?? [], (path) => path.textContent)).toEqual([
      "/pub/ordinary.app/",
      "/pub/",
      "/priv/vault/",
      "/",
    ]);
  });

  it.each([
    [{ path: "/pub/app/", read: true, write: false, scope: "specific" as const }, /allow requesting\.app to read your data/u],
    [{ path: "/pub/app/", read: false, write: true, scope: "specific" as const }, /allow requesting\.app to update your data/u],
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

    expect(await screen.findByRole("heading", { name: "Sign in to this service" })).toBeInTheDocument();
    expect(screen.getByText(/allow this service to read and update your data/u)).toBeInTheDocument();
  });

  it("uses a neutral progress label while completing the callback", async () => {
    MOCKS.authorizationState = { status: "completing", review: REVIEW };

    renderFlow();

    expect(await screen.findByRole("button", { name: "Completing…" })).toBeDisabled();
  });

  it("shows manual entry only when no authorization request was supplied", async () => {
    MOCKS.authorizationState = { status: "manual-entry" };
    renderFlow();

    expect(await screen.findByRole("heading", { name: "Authorize a service." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Invalid authorization request" })).not.toBeInTheDocument();
  });

  it("does not silently turn a malformed authorization request into manual entry", async () => {
    MOCKS.authorizationState = { status: "invalid" };
    renderFlow();

    expect(await screen.findByRole("heading", { name: "Invalid authorization request" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Authorize a service." })).not.toBeInTheDocument();
  });

  it("switches the active identity without losing the authorization review", async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByRole("heading", { name: "Sign in to requesting.app" });

    await user.click(screen.getByRole("button", { name: "Switch" }));
    expect(screen.getByRole("heading", { name: "Switch identity." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add identity/iu })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Second User/iu }));

    await waitFor(() => expect(screen.getByText("Second User")).toBeInTheDocument());
    expect(MOCKS.select).toHaveBeenCalledWith(SECOND.publicIdentity.publicKeyZ32);
    expect(screen.getByRole("heading", { name: "Sign in to requesting.app" })).toBeInTheDocument();
    expect(screen.getByText("seco...-key")).toHaveClass("normal-case");
    expect(screen.getByText("seco...-key")).not.toHaveClass("uppercase");
  });

  it("adds an identity through the normal sign-in flow without losing the review", async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByRole("heading", { name: "Sign in to requesting.app" });

    await user.click(screen.getByRole("button", { name: "Switch" }));
    await user.click(screen.getByRole("button", { name: /add identity/iu }));

    expect(screen.getByRole("heading", { name: "Add identity" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Complete identity setup" }));
    expect(screen.getByRole("heading", { name: "Sign in to requesting.app" })).toBeInTheDocument();
  });

  it("opens Google identity setup immediately when no local identity exists", async () => {
    MOCKS.catalog = { activePublicKeyZ32: null, identities: [] };
    renderFlow();

    expect(await screen.findByRole("heading", { name: "Add identity" })).toBeInTheDocument();
    expect(screen.queryByText("No local identity available")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("waits for explicit completion after the first identity enters the catalog", async () => {
    const user = userEvent.setup();
    MOCKS.catalog = { activePublicKeyZ32: null, identities: [] };
    renderFlow();
    await screen.findByRole("heading", { name: "Add identity" });

    MOCKS.catalog = { activePublicKeyZ32: FIRST.publicIdentity.publicKeyZ32, identities: [FIRST] };

    expect(screen.getByRole("heading", { name: "Add identity" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in to requesting.app" })).not.toBeInTheDocument();

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

  it("survives StrictMode effect replay and disposes after final unmount", async () => {
    const rendered = render(
      <StrictMode>
        <AuthorizationFlow />
      </StrictMode>,
    );
    await screen.findByRole("heading", { name: "Sign in to requesting.app" });
    await Promise.resolve();
    expect(MOCKS.dispose).not.toHaveBeenCalled();

    rendered.unmount();
    await waitFor(() => expect(MOCKS.dispose).toHaveBeenCalledOnce());
  });

  it.each([
    ["approved", "Authorization complete.", "Continue", "You can return to the app or device where you started."],
    ["cancelled", "Authorization cancelled.", "Back", "No authorization was granted."],
    ["failed", "Authorization failed.", "Back", "Passport could not authorize this request with the selected identity."],
  ] as const)("renders the safe local %s terminal state", async (status, heading, action, message) => {
    MOCKS.authorizationState = { status };
    renderFlow();

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
  });
});
