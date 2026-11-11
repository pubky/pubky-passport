/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "@/libs/logger/logger";
import { expectResultError, expectResultOk } from "@test-utils/resultAssertions";
import { APPLE_AUTHORIZE_URL, SignInWithApple } from "./SignInWithApple";

const SERVICES_ID = "app.pubky.passport.signin";
const REDIRECT_URI = "https://passport.pubky.app/";
const SUBJECT = "001234.abcdef.1234";
const APPLE_ORIGIN = "https://appleid.apple.com";

function idToken(claims: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", kid: "k" })}.${encode(claims)}.c2lnbmF0dXJl`;
}

function frameWindow(): Window {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  if (!frame.contentWindow) throw new Error("No frame window.");
  return frame.contentWindow;
}

/** Opens a sign-in against a stand-in popup and returns the authorize URL Passport opened. */
function start(continueInPopup?: Parameters<SignInWithApple["signIn"]>[0]) {
  const popup = frameWindow();
  const open = vi.fn(() => popup);
  const appWindow = window;
  appWindow.open = open as unknown as typeof window.open;
  const signIn = new SignInWithApple(SERVICES_ID, REDIRECT_URI, appWindow);
  const pending = signIn.signIn(continueInPopup);
  const url = new URL(String(open.mock.calls[0]?.[0 as never]));
  const state = url.searchParams.get("state") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";
  const respond = (data: unknown, origin = APPLE_ORIGIN, source: Window | null = popup) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ method: "oauthDone", data }),
        origin,
        source,
      }),
    );
  const success = (
    overrides: Record<string, unknown> = {},
    authorization = {},
    user?: unknown,
  ) => ({
    ...(user === undefined ? {} : { user }),
    authorization: {
      state,
      code: "authorization-code",
      id_token: idToken({
        iss: APPLE_ORIGIN,
        aud: SERVICES_ID,
        sub: SUBJECT,
        nonce,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 600,
        ...overrides,
      }),
      ...authorization,
    },
  });
  return { nonce, open, pending, popup, respond, state, success, url, signIn };
}

describe("SignInWithApple", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("hands off only a checked response and leaves the owned window open", async () => {
    const handoff = vi.fn(() => true);
    const { pending, popup, respond, success } = start(handoff);
    const close = vi.spyOn(popup, "close");
    respond(success(), "https://cdn.apple-cloudkit.com");
    expect(handoff).not.toHaveBeenCalled();
    respond(success());
    expectResultOk(await pending);
    expect(handoff).toHaveBeenCalledWith(popup, expect.objectContaining({ appleSubject: SUBJECT }));
    expect(close).not.toHaveBeenCalled();
  });

  it("does not hand off an invalid state or nonce", async () => {
    const handoff = vi.fn(() => true);
    const { pending, respond, success } = start(handoff);
    respond(success({ nonce: "wrong" }));
    expectResultError(await pending, { code: "apple_sign_in_failed" });
    expect(handoff).not.toHaveBeenCalled();
  });

  it("releases a cancelled first step and ignores its late reply", async () => {
    const handoff = vi.fn(() => true);
    const { pending, respond, success, signIn } = start(handoff);
    signIn.cancel();
    expectResultError(await pending, { code: "apple_sign_in_cancelled" });
    respond(success());
    expect(handoff).not.toHaveBeenCalled();
  });

  it("focuses the pending Apple popup without retaining it after handoff", async () => {
    const { open, pending, popup, respond, success, signIn } = start(() => true);
    const focus = vi.spyOn(popup, "focus").mockImplementation(() => undefined);
    const close = vi.spyOn(popup, "close").mockImplementation(() => undefined);
    signIn.focusPopup();
    expect(focus).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();

    respond(success());
    expectResultOk(await pending);
    signIn.focusPopup();
    signIn.cancel();
    expect(focus).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it("cancels and releases timers when focusing a closed popup", async () => {
    vi.useFakeTimers();
    const popup = { closed: false, close: vi.fn(), focus: vi.fn() };
    window.open = vi.fn(() => popup) as unknown as typeof window.open;
    const signIn = new SignInWithApple(SERVICES_ID, REDIRECT_URI, window);
    const pending = signIn.signIn();
    popup.closed = true;

    signIn.focusPopup();

    expectResultError(await pending, { code: "apple_sign_in_cancelled" });
    expect(popup.focus).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps sign-in usable when the browser refuses to focus the popup", async () => {
    const { pending, popup, respond, success, signIn } = start();
    vi.spyOn(popup, "focus").mockImplementation(() => {
      throw new DOMException("Focus unavailable", "SecurityError");
    });
    expect(() => signIn.focusPopup()).not.toThrow();
    respond(success());
    expectResultOk(await pending);
  });

  it("opens Apple's authorize page synchronously, without Apple's script", async () => {
    const { open, pending, respond, success, url } = start();

    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(expect.any(String), "_blank", "popup,width=390,height=700");
    expect(`${url.origin}${url.pathname}`).toBe(APPLE_AUTHORIZE_URL);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: SERVICES_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code id_token",
      response_mode: "web_message",
    });
    expect(url.searchParams.get("scope")).toBe("name email");
    // Percent-encoded like Apple's own script.
    expect(url.search).toContain("scope=name%20email");
    expect(url.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(document.querySelectorAll("script")).toHaveLength(0);

    respond(success());
    const credentials = expectResultOk(await pending);
    expect(credentials.appleSubject).toBe(SUBJECT);
    expect(Object.keys(credentials).sort()).toEqual([
      "appleIdToken",
      "appleSubject",
      "email",
      "expiresAt",
      "name",
    ]);
    expect(credentials).toMatchObject({ email: null, name: null });
  });

  it("reads the email claim and the name Apple sends on the first authorization", async () => {
    const { pending, respond, success } = start();
    respond(
      success(
        { email: "abc123@privaterelay.appleid.com", is_private_email: "true" },
        {},
        {
          name: { firstName: " Jane ", lastName: "Appleseed" },
          email: "abc123@privaterelay.appleid.com",
        },
      ),
    );
    expect(expectResultOk(await pending)).toMatchObject({
      email: "abc123@privaterelay.appleid.com",
      name: "Jane Appleseed",
    });
  });

  it("accepts the user object as a JSON string, as in form_post mode", async () => {
    const { pending, respond, success } = start();
    respond(success({}, {}, JSON.stringify({ name: { firstName: "Jane" } })));
    expect(expectResultOk(await pending).name).toBe("Jane");
  });

  it.each([
    ["no user object", undefined],
    ["an empty name", { name: { firstName: " ", lastName: "" } }],
    ["a name of the wrong type", { name: "Jane" }],
    ["malformed JSON", "{"],
    ["an oversized name", { name: { firstName: "x".repeat(600) } }],
  ])("keeps no name for %s", async (_name, user) => {
    const { pending, respond, success } = start();
    respond(success({}, {}, user));
    expect(expectResultOk(await pending).name).toBeNull();
  });

  it.each([
    ["a missing claim", undefined],
    ["a non-string claim", 42],
    ["a value without @", "jane"],
  ])("keeps no email for %s", async (_name, email) => {
    const { pending, respond, success } = start();
    respond(success({ email }));
    expect(expectResultOk(await pending).email).toBeNull();
  });

  it("ignores messages from other windows or origins", async () => {
    const { pending, respond, success } = start();
    respond(success({ sub: "attacker" }), "https://evil.example");
    respond(success({ sub: "attacker" }), APPLE_ORIGIN, frameWindow());
    respond(success());
    expect(expectResultOk(await pending).appleSubject).toBe(SUBJECT);
  });

  it("caps the token lifetime at ten minutes after issue", async () => {
    const { pending, respond, success } = start();
    const iat = Math.floor(Date.now() / 1000) - 60;
    respond(success({ iat, exp: iat + 3_600 }));
    expect(expectResultOk(await pending).expiresAt).toBe((iat + 600) * 1000);
  });

  it.each([
    ["state", {}, { state: "other" }],
    ["nonce", { nonce: "replayed" }, {}],
    ["audience", { aud: "other.app" }, {}],
    ["issuer", { iss: "https://accounts.google.com" }, {}],
    ["expiry", { exp: 1 }, {}],
    ["issue time", { iat: undefined }, {}],
    ["subject", { sub: "" }, {}],
    ["token", {}, { id_token: "not-a-jwt" }],
  ])("rejects a response with a bad %s", async (_name, claims, authorization) => {
    vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const { pending, respond, success } = start();
    respond(success(claims, authorization));
    expectResultError(await pending, { code: "apple_sign_in_failed" });
  });

  it.each([
    ["popup_closed_by_user", "apple_sign_in_cancelled"],
    ["user_cancelled_authorize", "apple_sign_in_cancelled"],
    ["invalid_request", "apple_sign_in_failed"],
  ] as const)("maps Apple's %s error", async (error, code) => {
    vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    const { pending, respond } = start();
    respond({ error });
    expectResultError(await pending, { code });
  });

  it("treats a closed popup as cancelled", async () => {
    vi.useFakeTimers();
    vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    const popup = { closed: false, close: vi.fn() };
    window.open = vi.fn(() => popup) as unknown as typeof window.open;
    const pending = new SignInWithApple(SERVICES_ID, REDIRECT_URI, window).signIn();
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(400);
    expectResultError(await pending, { code: "apple_sign_in_cancelled" });
  });

  it("reports a blocked popup", async () => {
    vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    window.open = vi.fn(() => null) as unknown as typeof window.open;
    expectResultError(await new SignInWithApple(SERVICES_ID, REDIRECT_URI, window).signIn(), {
      code: "apple_sign_in_popup_blocked",
    });
  });

  it("never logs the name or email", async () => {
    const logs = [
      vi.spyOn(LOGGER, "info").mockImplementation(() => undefined),
      vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined),
    ];
    const { pending, respond, success } = start();
    respond(
      success(
        { email: "jane@example.com", nonce: "replayed" },
        {},
        { name: { firstName: "Jane" } },
      ),
    );
    await pending;
    const logged = JSON.stringify(logs.map((log) => log.mock.calls));
    expect(logged).not.toContain("jane@example.com");
    expect(logged).not.toContain("Jane");
  });

  it("never logs the ID token or subject", async () => {
    const warn = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const { pending, respond, success } = start();
    respond(success({ aud: "SECRET-AUDIENCE" }));
    await pending;
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-AUDIENCE");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SUBJECT);
  });
});
