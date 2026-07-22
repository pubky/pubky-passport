/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  googleDriveAppDataScope,
  type GoogleAccounts,
} from "../browser/identity/google/googleIdentityProvider";
import { GoogleSignInButton } from "./googleSignInButton";

describe("GoogleSignInButton", () => {
  afterEach(() => {
    cleanup();
    delete window.google;
    vi.unstubAllGlobals();
  });

  it("requests Drive access for the account that supplied the ID token", async () => {
    const credentialCallbacks: Array<(response: { credential?: unknown }) => void> = [];
    const accessTokenCallbacks: Array<(response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void> = [];
    let tokenClientConfig: { client_id: string; scope: string; login_hint?: string } | undefined;
    const requestAccessToken = vi.fn();
    const renderButton = vi.fn();
    const onAuthorized = vi.fn(async () => {});
    const userInfoFetch = vi.fn(async () => Response.json({ sub: "google-subject" }));
    const accounts: GoogleAccounts = {
      id: {
        initialize(config) {
          credentialCallbacks.push(config.callback);
        },
        renderButton,
      },
      oauth2: {
        initTokenClient(config) {
          accessTokenCallbacks.push(config.callback);
          tokenClientConfig = config;
          return { requestAccessToken };
        },
      },
    };
    window.google = { accounts };
    vi.stubGlobal("fetch", userInfoFetch);

    render(<GoogleSignInButton clientId="google-client" disabled={false} onAuthorized={onAuthorized} />);

    await waitFor(() => expect(credentialCallbacks).toHaveLength(1));
    expect(renderButton).toHaveBeenCalledWith(expect.any(HTMLDivElement), {
      theme: "outline",
      size: "large",
      text: "continue_with",
    });

    await act(async () => credentialCallbacks[0]?.({ credential: googleIdToken("google-subject") }));

    expect((screen.getByRole("button", { name: "Allow Drive access" }) as HTMLButtonElement).disabled).toBe(false);

    await userEvent.setup().click(screen.getByRole("button", { name: "Allow Drive access" }));
    await waitFor(() => expect(tokenClientConfig).toBeDefined());
    expect(tokenClientConfig).toMatchObject({
      client_id: "google-client",
      scope: `openid ${googleDriveAppDataScope}`,
      login_hint: "google-subject",
    });
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: "" });

    act(() => { void accessTokenCallbacks[0]?.({ access_token: "drive-token", scope: googleDriveAppDataScope }); });

    await waitFor(() => expect(onAuthorized).toHaveBeenCalledWith(googleIdToken("google-subject"), "drive-token"));
    expect(userInfoFetch).toHaveBeenCalledWith("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: "Bearer drive-token" },
      signal: expect.any(AbortSignal),
    });
  });

  it("ignores Drive callbacks from a superseded authorization attempt", async () => {
    const credentialCallbacks: Array<(response: { credential?: unknown }) => void> = [];
    const accessTokenCallbacks: Array<(response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void> = [];
    const onAuthorized = vi.fn(async () => {});
    const accounts: GoogleAccounts = {
      id: {
        initialize(config) {
          credentialCallbacks.push(config.callback);
        },
        renderButton: vi.fn(),
      },
      oauth2: {
        initTokenClient(config) {
          accessTokenCallbacks.push(config.callback);
          return { requestAccessToken: vi.fn() };
        },
      },
    };
    window.google = { accounts };

    render(<GoogleSignInButton clientId="google-client" disabled={false} onAuthorized={onAuthorized} />);

    await waitFor(() => expect(credentialCallbacks).toHaveLength(1));
    await act(async () => credentialCallbacks[0]?.({ credential: googleIdToken("google-subject") }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Allow Drive access" }));
    await waitFor(() => expect(accessTokenCallbacks).toHaveLength(1));
    await act(async () => accessTokenCallbacks[0]?.({ access_token: "drive-token", scope: "openid" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Google Drive permission was not granted. Try again."));
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeDefined());

    await act(async () => accessTokenCallbacks[0]?.({ access_token: "drive-token", scope: "openid" }));

    expect(onAuthorized).not.toHaveBeenCalled();
    expect(credentialCallbacks).toHaveLength(1);
  });

  it("recovers from a closed popup and ignores its late token callback", async () => {
    const credentialCallbacks: Array<(response: { credential?: unknown }) => void> = [];
    const accessTokenCallbacks: Array<(response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void> = [];
    const oauthErrorCallbacks: Array<(error: { type?: unknown }) => void> = [];
    const initialize = vi.fn((config: { callback: (response: { credential?: unknown }) => void }) => credentialCallbacks.push(config.callback));
    const renderButton = vi.fn();
    const onAuthorized = vi.fn(async () => {});
    window.google = { accounts: {
      id: { initialize, renderButton },
      oauth2: {
        initTokenClient(config) {
          accessTokenCallbacks.push(config.callback);
          oauthErrorCallbacks.push(config.error_callback);
          return { requestAccessToken: vi.fn() };
        },
      },
    } };

    render(<GoogleSignInButton clientId="google-client" disabled={false} onAuthorized={onAuthorized} />);
    await waitFor(() => expect(credentialCallbacks).toHaveLength(1));
    await act(async () => credentialCallbacks[0]?.({ credential: googleIdToken("google-subject") }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Allow Drive access" }));
    await waitFor(() => expect(oauthErrorCallbacks).toHaveLength(1));
    await act(async () => oauthErrorCallbacks[0]?.({ type: "popup_closed" }));

    expect(screen.getByRole("alert").textContent).toBe("The Google Drive window was closed. Try again.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
    await act(async () => accessTokenCallbacks[0]?.({ access_token: "late-token", scope: googleDriveAppDataScope }));
    expect(onAuthorized).not.toHaveBeenCalled();
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(renderButton).toHaveBeenCalledTimes(2);
  });

  it("offers tailored retry guidance when Drive account verification is unavailable", async () => {
    let credentialCallback: ((response: { credential?: unknown }) => void) | undefined;
    let accessTokenCallback: ((response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) | undefined;
    window.google = { accounts: {
      id: { initialize(config) { credentialCallback = config.callback; }, renderButton: vi.fn() },
      oauth2: { initTokenClient(config) { accessTokenCallback = config.callback; return { requestAccessToken: vi.fn() }; } },
    } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));

    render(<GoogleSignInButton clientId="google-client" disabled={false} onAuthorized={vi.fn(async () => {})} />);
    await waitFor(() => expect(credentialCallback).toBeDefined());
    await act(async () => credentialCallback?.({ credential: googleIdToken("google-subject") }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Allow Drive access" }));
    await waitFor(() => expect(accessTokenCallback).toBeDefined());
    act(() => { void accessTokenCallback?.({ access_token: "drive-token", scope: googleDriveAppDataScope }); });

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(
      "Google Drive account verification is unavailable. Check your connection and try again.",
    ));
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });

  it("aborts pending Drive account verification when unmounted", async () => {
    const credentialCallbacks: Array<(response: { credential?: unknown }) => void> = [];
    const accessTokenCallbacks: Array<(response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void> = [];
    const userInfoSignal: { current: AbortSignal | null } = { current: null };
    const userInfoFetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      userInfoSignal.current = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => userInfoSignal.current?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    }) as unknown as typeof fetch;
    window.google = { accounts: {
      id: { initialize(config) { credentialCallbacks.push(config.callback); }, renderButton: vi.fn() },
      oauth2: { initTokenClient(config) { accessTokenCallbacks.push(config.callback); return { requestAccessToken: vi.fn() }; } },
    } };
    vi.stubGlobal("fetch", userInfoFetch);
    const onAuthorized = vi.fn(async () => {});

    const view = render(<GoogleSignInButton clientId="google-client" disabled={false} onAuthorized={onAuthorized} />);
    await waitFor(() => expect(credentialCallbacks).toHaveLength(1));
    await act(async () => credentialCallbacks[0]?.({ credential: googleIdToken("google-subject") }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Allow Drive access" }));
    await waitFor(() => expect(accessTokenCallbacks).toHaveLength(1));
    act(() => { void accessTokenCallbacks[0]?.({ access_token: "drive-token", scope: googleDriveAppDataScope }); });
    await waitFor(() => expect(userInfoSignal.current).not.toBeNull());

    view.unmount();

    expect(userInfoSignal.current?.aborted).toBe(true);
    expect(onAuthorized).not.toHaveBeenCalled();
  });

  it("initializes the global Google identity client once across component remounts", async () => {
    const credentialCallbacks: Array<(response: { credential?: unknown }) => void> = [];
    const initialize = vi.fn((config: { callback: (response: { credential?: unknown }) => void }) => {
      credentialCallbacks.push(config.callback);
    });
    const renderButton = vi.fn();
    const accounts: GoogleAccounts = {
      id: { initialize, renderButton },
      oauth2: {
        initTokenClient() {
          return { requestAccessToken: vi.fn() };
        },
      },
    };
    window.google = { accounts };

    const first = render(<GoogleSignInButton clientId="google-client" disabled={false} onAuthorized={vi.fn(async () => {})} />);
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<GoogleSignInButton clientId="google-client" disabled={false} onAuthorized={vi.fn(async () => {})} />);
    await waitFor(() => expect(renderButton).toHaveBeenCalledTimes(2));
    expect(initialize).toHaveBeenCalledTimes(1);

    await act(async () => credentialCallbacks[0]?.({ credential: googleIdToken("google-subject") }));
    expect(screen.getByRole("button", { name: "Allow Drive access" })).toBeDefined();
  });
});

function googleIdToken(subject: string): string {
  const payload = btoa(JSON.stringify({ sub: subject })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `header.${payload}.signature`;
}
