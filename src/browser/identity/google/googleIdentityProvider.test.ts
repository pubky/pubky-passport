/** @vitest-environment jsdom */

import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  googleDriveAppDataScope,
  requestGoogleDriveAccess,
  type GoogleAccounts,
} from "./googleIdentityProvider";

describe("requestGoogleDriveAccess", () => {
  afterEach(() => {
    delete window.google;
  });

  it("rejects an OAuth response that lacks the Drive app data scope", async () => {
    let accessTokenCallback: ((response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) | undefined;
    let tokenClientConfig: { client_id: string; scope: string; hint?: string } | undefined;
    const requestAccessToken = vi.fn();
    const accounts: GoogleAccounts = {
      id: {
        initialize: vi.fn(),
        renderButton: vi.fn(),
      },
      oauth2: {
        initTokenClient(config) {
          accessTokenCallback = config.callback;
          tokenClientConfig = config;
          return { requestAccessToken };
        },
      },
    };
    window.google = { accounts };
    const resultPromise = requestGoogleDriveAccess({ clientId: "google-client", hint: "google-subject" });

    await vi.waitFor(() => expect(accessTokenCallback).toBeDefined());
    expect(tokenClientConfig).toMatchObject({
      hint: "google-subject",
      scope: `openid ${googleDriveAppDataScope}`,
    });
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: "" });

    accessTokenCallback?.({ access_token: "drive-token", scope: "openid" });

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "drive_consent_failed" });
  });

  it("rejects a Drive token issued for a different Google subject", async () => {
    let accessTokenCallback: ((response: { access_token?: unknown; error?: unknown; scope?: unknown }) => void) | undefined;
    const accounts: GoogleAccounts = {
      id: {
        initialize: vi.fn(),
        renderButton: vi.fn(),
      },
      oauth2: {
        initTokenClient(config) {
          accessTokenCallback = config.callback;
          return { requestAccessToken: vi.fn() };
        },
      },
    };
    window.google = { accounts };

    const resultPromise = requestGoogleDriveAccess({
      clientId: "google-client",
      expectedSubject: "google-subject",
      fetch: (async () => Response.json({ sub: "different-subject" })) as typeof fetch,
    });

    await vi.waitFor(() => expect(accessTokenCallback).toBeDefined());
    accessTokenCallback?.({ access_token: "drive-token", scope: googleDriveAppDataScope });

    const result = await resultPromise;
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "drive_account_mismatch" });
  });
});
