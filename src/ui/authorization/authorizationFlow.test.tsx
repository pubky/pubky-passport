/** @vitest-environment jsdom */

import { Result } from "better-result";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PassportAuthorizationViewState } from "../../browser/authorization/passportAuthorization";
import type { PassportIdentityList } from "../../browser/identity/passportIdentityController";
import { AuthorizationFlow } from "./authorizationFlow";

const MOCKS = vi.hoisted(() => ({
  approve: vi.fn(),
  authorizationListener: null as null | (() => void),
  authorizationState: undefined as PassportAuthorizationViewState | undefined,
  cancel: vi.fn(),
  catalogListener: null as null | (() => void),
  catalog: undefined as PassportIdentityList | undefined,
  commitInitialEntry: vi.fn(),
  dispose: vi.fn(),
  select: vi.fn(),
  createAuthorizationController: vi.fn(),
}));

vi.mock("../../browser/authorization/passportAuthorization", () => ({
  createPassportAuthorizationController: (...args: unknown[]) => {
    MOCKS.createAuthorizationController(...args);
    return {
      approve: MOCKS.approve,
      cancel: MOCKS.cancel,
      commitInitialEntry: MOCKS.commitInitialEntry,
      getState: () => MOCKS.authorizationState,
      subscribe: (listener: () => void) => { MOCKS.authorizationListener = listener; return () => { MOCKS.authorizationListener = null; }; },
    };
  },
}));

vi.mock("../../browser/identity/passportIdentityController", () => ({
  PassportIdentityController: class {
    dispose = MOCKS.dispose;
    list = () => Result.ok(MOCKS.catalog);
    select = MOCKS.select;
    subscribe = (listener: () => void) => { MOCKS.catalogListener = listener; return () => { MOCKS.catalogListener = null; }; };
  },
}));

vi.mock("../onboarding/signInFlow", () => ({
  SignInFlow: ({ onBack, onComplete }: { onBack?: () => void; onComplete: () => void }) => (
    <main>
      <h1>Add identity</h1>
      <button onClick={onComplete} type="button">Complete identity setup</button>
      {onBack ? <button onClick={onBack} type="button">Back</button> : null}
    </main>
  ),
}));

const REVIEW = {
  kind: "signin",
  authenticationMethod: "cookie",
  capabilities: [
    { path: "/pub/requesting.app/", read: true, write: true, scope: "specific" },
    { path: "/pub/paykit/", read: true, write: false, scope: "specific" },
  ],
  callbackAvailability: { success: true, error: true, cancel: true },
  relayHost: "relay.example",
  requestingAppDisplayHost: "requesting.app",
} as const;

const FIRST = {
  id: "first-public-key",
  publicIdentity: { publicKeyDisplay: "pubkyfirst", publicKeyZ32: "first-public-key" },
  googleAccount: { email: "first@example.com", id: "google-first", name: "First User", pictureUrl: null },
};
const SECOND = {
  id: "second-public-key",
  publicIdentity: { publicKeyDisplay: "pubkysecond", publicKeyZ32: "second-public-key" },
  googleAccount: { email: "second@example.com", id: "google-second", name: "Second User", pictureUrl: null },
};

describe("AuthorizationFlow", () => {
  beforeEach(() => {
    MOCKS.authorizationState = { status: "review", review: REVIEW };
    MOCKS.catalog = { activeIdentityId: FIRST.id, identities: [FIRST, SECOND] };
    MOCKS.approve.mockResolvedValue({ status: "approving", review: REVIEW });
    MOCKS.cancel.mockResolvedValue({ status: "cancelled" });
    MOCKS.select.mockImplementation((identityId: string) => {
      if (!MOCKS.catalog) return Result.err({ code: "storage_unavailable" as const });
      MOCKS.catalog = { ...MOCKS.catalog, activeIdentityId: identityId };
      MOCKS.catalogListener?.();
      return Result.ok();
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    MOCKS.authorizationListener = null;
    MOCKS.catalogListener = null;
  });

  const renderFlow = () => render(
    <AuthorizationFlow
      googleClientId="google-client-id"
      homegateBaseUrl="https://homegate.example/"
    />,
  );

  it("shows the callback domain, requested permissions, and active identity", async () => {
    renderFlow();

    expect(await screen.findByRole("heading", { name: "Sign in to requesting.app" })).toBeInTheDocument();
    expect(screen.getByText("/pub/requesting.app/")).toBeInTheDocument();
    expect(screen.getByText("Read,Write")).toBeInTheDocument();
    expect(screen.getByText("First User")).toBeInTheDocument();
    expect(screen.getByText(/allow requesting\.app to read and update your data/u)).toBeInTheDocument();
    expect(screen.getByText(/deprecated cookie authentication/u)).toBeInTheDocument();
    expect(MOCKS.commitInitialEntry).toHaveBeenCalledOnce();
    expect(MOCKS.createAuthorizationController).toHaveBeenCalledWith();
  });

  it("identifies a grant request by its v0.10 client ID", async () => {
    MOCKS.authorizationState = {
      status: "review",
      review: { ...REVIEW, authenticationMethod: "grant", clientId: "grant-client.example" },
    };

    renderFlow();

    expect(await screen.findByRole("heading", { name: "Sign in to grant-client.example" })).toBeInTheDocument();
    expect(screen.getByText(/app-specific, revocable grant/u)).toBeInTheDocument();
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
    expect(MOCKS.select).toHaveBeenCalledWith(SECOND.id);
    expect(screen.getByRole("heading", { name: "Sign in to requesting.app" })).toBeInTheDocument();
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
    MOCKS.catalog = { activeIdentityId: null, identities: [] };
    renderFlow();

    expect(await screen.findByRole("heading", { name: "Add identity" })).toBeInTheDocument();
    expect(screen.queryByText("No local identity available")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("waits for explicit completion after the first identity enters the catalog", async () => {
    const user = userEvent.setup();
    MOCKS.catalog = { activeIdentityId: null, identities: [] };
    renderFlow();
    await screen.findByRole("heading", { name: "Add identity" });

    act(() => {
      MOCKS.catalog = { activeIdentityId: FIRST.id, identities: [FIRST] };
      MOCKS.catalogListener?.();
    });

    expect(screen.getByRole("heading", { name: "Add identity" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in to requesting.app" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Complete identity setup" }));
    expect(screen.getByRole("heading", { name: "Sign in to requesting.app" })).toBeInTheDocument();
  });

  it("cancels authorization from first-identity setup", async () => {
    const user = userEvent.setup();
    MOCKS.catalog = { activeIdentityId: null, identities: [] };
    renderFlow();

    await user.click(await screen.findByRole("button", { name: "Back" }));

    expect(MOCKS.cancel).toHaveBeenCalledOnce();
  });

  it("authorizes with the selected identity", async () => {
    const user = userEvent.setup();
    renderFlow();
    await screen.findByRole("heading", { name: "Sign in to requesting.app" });

    await user.click(screen.getByRole("button", { name: "Authorize" }));

    expect(MOCKS.approve).toHaveBeenCalledOnce();
  });

  it.each([
    ["approved", "Authorization complete."],
    ["cancelled", "Authorization cancelled."],
  ] as const)("renders the safe local %s terminal state", async (status, heading) => {
    MOCKS.authorizationState = { status };
    renderFlow();

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  });
});
