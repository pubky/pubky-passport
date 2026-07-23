/** @vitest-environment jsdom */

import { Result } from "better-result";
import { StrictMode, type ComponentProps } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActiveAuthorizationResult } from "../browser/authorization/approveActiveAuthorization";
import { pubkyAuthRequestLimits } from "../features/auth/pubkyAuthRequestLimits";
import { AuthorizationReview } from "./authorizationReview";

const relayOrigin = "https://relay.example";
const successCallback = "https://app.example/success?code=private";
const errorCallback = "https://app.example/error?code=private";
const cancelCallback = "https://app.example/cancel?code=private";
const secret = "sensitive-authorization-secret";

describe("AuthorizationReview", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it("scrubs the query immediately, parses once under StrictMode, and renders only safe review data", () => {
    setAuthorizationUrl(validRequest());

    render(
      <StrictMode>
        <AuthorizationReview allowLocalhostCallbacks={false} relayOrigin={relayOrigin} />
      </StrictMode>,
    );

    expect(window.location.pathname).toBe("/authorize");
    expect(window.location.search).toBe("");
    expect(screen.getByRole("heading", { name: "app.example" })).toBeTruthy();
    expect(screen.getByText("/pub/example.app/")).toBeTruthy();
    expect(document.body.textContent).not.toContain(secret);
    expect(document.body.textContent).not.toContain(successCallback);
    expect(document.body.textContent).not.toContain(errorCallback);
    expect(document.body.textContent).not.toContain(cancelCallback);
  });

  it("bypasses framework-patched history methods while scrubbing", () => {
    setAuthorizationUrl(validRequest({ callbacks: false }));
    const frameworkReplaceState = vi.fn();
    Object.defineProperty(window.history, "replaceState", {
      configurable: true,
      value: frameworkReplaceState,
    });

    try {
      renderReview({ approve: vi.fn(async () => Result.ok()), navigate: vi.fn() });

      expect(window.location.search).toBe("");
      expect(frameworkReplaceState).not.toHaveBeenCalled();
      expect(screen.getByRole("heading", { name: "An app" })).toBeTruthy();
      expect(screen.getByText("/pub/example.app/")).toBeTruthy();
    } finally {
      Reflect.deleteProperty(window.history, "replaceState");
    }
  });

  it("does not reuse an approval from an abandoned render on a later no-d visit", async () => {
    setAuthorizationUrl(validRequest());

    expect(() => render(
      <>
        <AuthorizationReview allowLocalhostCallbacks={false} relayOrigin={relayOrigin} />
        <AbandonRender />
      </>,
    )).toThrow("abandoned render");

    await Promise.resolve();
    window.history.replaceState({}, "", "/authorize");
    renderReview({ approve: vi.fn(async () => Result.ok()), navigate: vi.fn() });

    expect(screen.getByRole("heading", { name: "Invalid authorization request" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("rejects an unencoded d value without normalizing it", () => {
    setRawAuthorizationQuery(`d=${validRequest()}`);

    renderReview({ approve: vi.fn(async () => Result.ok()), navigate: vi.fn() });

    expect(window.location.search).toBe("");
    expect(screen.getByRole("heading", { name: "Invalid authorization request" })).toBeTruthy();
  });

  it("rejects an oversized raw percent-encoded d before decoding", () => {
    setRawAuthorizationQuery(`d=${"%41".repeat(Math.ceil(pubkyAuthRequestLimits.encodedDLength / 3) + 1)}`);

    renderReview({ approve: vi.fn(async () => Result.ok()), navigate: vi.fn() });

    expect(window.location.search).toBe("");
    expect(screen.getByRole("heading", { name: "Invalid authorization request" })).toBeTruthy();
  });

  it.each([
    `d=${encodeURIComponent(validRequest())}&d=${encodeURIComponent(validRequest())}`,
    "d=%E0%A4%A",
  ])("rejects duplicate or malformed raw d input safely", (query) => {
    setRawAuthorizationQuery(query);

    renderReview({ approve: vi.fn(async () => Result.ok()), navigate: vi.fn() });

    expect(window.location.search).toBe("");
    expect(screen.getByRole("heading", { name: "Invalid authorization request" })).toBeTruthy();
  });

  it("approves once and redirects to the exact success callback", async () => {
    const user = userEvent.setup();
    const approve = vi.fn(async () => Result.ok());
    const navigate = vi.fn();
    setAuthorizationUrl(validRequest());
    renderReview({ approve, navigate });

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(successCallback));
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("redirects approval failures to the exact error callback", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    setAuthorizationUrl(validRequest());
    renderReview({ approve: async () => Result.err({ code: "approval_failed" }), navigate });

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(errorCallback));
  });

  it("cancels through the validated x-cancel callback without approving", async () => {
    const user = userEvent.setup();
    const approve = vi.fn(async () => Result.ok());
    const navigate = vi.fn();
    setAuthorizationUrl(validRequest());
    renderReview({ approve, navigate });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(navigate).toHaveBeenCalledWith(cancelCallback);
    expect(approve).not.toHaveBeenCalled();
  });

  it("blocks duplicate approval clicks while approval is pending", async () => {
    const user = userEvent.setup();
    let complete: ((result: ActiveAuthorizationResult) => void) | undefined;
    const approve = vi.fn(() => new Promise<ActiveAuthorizationResult>((resolve) => { complete = resolve; }));
    setAuthorizationUrl(validRequest());
    renderReview({ approve, navigate: vi.fn() });
    const button = screen.getByRole("button", { name: "Approve" });

    await user.dblClick(button);

    expect(approve).toHaveBeenCalledTimes(1);
    complete?.(Result.ok());
  });

  it("renders safe local terminal states when callbacks are absent", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    setAuthorizationUrl(validRequest({ callbacks: false }));
    const rendered = renderReview({ approve: async () => Result.ok(), navigate });

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("heading", { name: "Authorization complete" })).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();

    rendered.unmount();
    setAuthorizationUrl(validRequest({ callbacks: false }));
    renderReview({ approve: async () => Result.ok(), navigate });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Authorization cancelled" })).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([
    ["no_active_identity", /could not find an active identity/],
    ["identity_restore_failed", /could not restore the active identity/],
    ["approval_failed", /could not sign or deliver this authorization/],
  ] as const)("retains and explains the %s failure code locally", async (code, message) => {
    const user = userEvent.setup();
    setAuthorizationUrl(validRequest({ callbacks: false }));
    renderReview({ approve: async () => Result.err({ code }), navigate: vi.fn() });

    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByRole("heading", { name: "Authorization failed" })).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
  });

  it.each([
    ["success", async () => Result.ok(), "Authorization complete", "Approve"],
    ["error", async () => Result.err({ code: "approval_failed" as const }), "Authorization failed", "Approve"],
    ["cancel", async () => Result.ok(), "Authorization cancelled", "Cancel"],
  ])("falls back to the local %s state when callback navigation throws", async (_outcome, approve, heading, action) => {
    const user = userEvent.setup();
    setAuthorizationUrl(validRequest());
    renderReview({ approve, navigate: () => { throw new Error("navigation unavailable"); } });

    await user.click(screen.getByRole("button", { name: action }));

    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
  });

  it("never redirects or approves an invalid request", () => {
    const approve = vi.fn(async () => Result.ok());
    const navigate = vi.fn();
    setAuthorizationUrl("pubkyauth://signin?secret=invalid-secret");
    renderReview({ approve, navigate });

    expect(window.location.pathname).toBe("/authorize");
    expect(window.location.search).toBe("");
    expect(screen.getByRole("heading", { name: "Invalid authorization request" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("invalid-secret");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(approve).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

function renderReview(input: {
  approve: (approval: Parameters<NonNullable<ComponentProps<typeof AuthorizationReview>["approveAuthorization"]>>[0]) => Promise<ActiveAuthorizationResult>;
  navigate: (url: string) => void;
}) {
  return render(
    <AuthorizationReview
      allowLocalhostCallbacks={false}
      approveAuthorization={input.approve}
      navigate={input.navigate}
      relayOrigin={relayOrigin}
    />,
  );
}

function setAuthorizationUrl(request: string): void {
  window.history.replaceState({}, "", `/authorize?d=${encodeURIComponent(request)}`);
}

function setRawAuthorizationQuery(query: string): void {
  window.history.replaceState({}, "", `/authorize?${query}`);
}

function AbandonRender(): never {
  throw new Error("abandoned render");
}

function validRequest(options: { callbacks?: boolean } = {}): string {
  const callbacks = options.callbacks === false
    ? ""
    : `&x-success=${encodeURIComponent(successCallback)}&x-error=${encodeURIComponent(errorCallback)}&x-cancel=${encodeURIComponent(cancelCallback)}`;
  return `pubkyauth://signin?caps=/pub/example.app/:rw&relay=${encodeURIComponent(`${relayOrigin}/inbox`)}&secret=${secret}${callbacks}`;
}
