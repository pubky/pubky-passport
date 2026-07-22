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
    let tokenClientConfig: { client_id: string; scope: string; hint?: string } | undefined;
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
      hint: "google-subject",
    });
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: "" });

    await act(async () => accessTokenCallbacks[0]?.({ access_token: "drive-token", scope: googleDriveAppDataScope }));

    await waitFor(() => expect(onAuthorized).toHaveBeenCalledWith(googleIdToken("google-subject"), "drive-token"));
    expect(userInfoFetch).toHaveBeenCalledWith("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: "Bearer drive-token" },
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
    await waitFor(() => expect(credentialCallbacks).toHaveLength(2));

    await act(async () => accessTokenCallbacks[0]?.({ access_token: "drive-token", scope: "openid" }));

    expect(onAuthorized).not.toHaveBeenCalled();
  });
});

function googleIdToken(subject: string): string {
  const payload = btoa(JSON.stringify({ sub: subject })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `header.${payload}.signature`;
}
