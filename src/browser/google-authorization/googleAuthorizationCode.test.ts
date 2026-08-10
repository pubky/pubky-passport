import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleIdentityServices, type GoogleAccounts } from "../google-identity-services/googleIdentityServices";
import { GoogleAuthorizationCode } from "./googleAuthorizationCode";

describe("GoogleAuthorizationCode", () => {
  afterEach(() => vi.restoreAllMocks());

  it("obtains identity and Drive credentials from one code request", async () => {
    let callback: ((response: { code?: unknown }) => void) | undefined;
    const requestCode = vi.fn(() => callback?.({ code: "one-time-code" }));
    const services = new GoogleIdentityServices();
    let requestedScope = "";
    let requestedLoginHint: string | undefined;
    const initCodeClient = vi.fn((config: Parameters<NonNullable<GoogleAccounts["oauth2"]["initCodeClient"]>>[0]) => {
      callback = config.callback;
      requestedScope = config.scope;
      requestedLoginHint = config.login_hint;
      return { requestCode };
    });
    vi.spyOn(services, "loadGoogleAccounts").mockResolvedValue(Result.ok({
      oauth2: { initCodeClient },
    }));
    const googleAccount = { id: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: null };
    const fetch = vi.fn(async () => Response.json({ googleIdToken: "id-token", driveAccessToken: "drive-token", googleAccount }));
    const authorization = new GoogleAuthorizationCode({ clientId: "client-id", googleIdentityServices: services, fetch });

    await expect(authorization.prepare()).resolves.toEqual(Result.ok());
    await expect(authorization.request()).resolves.toEqual(Result.ok({ googleIdToken: "id-token", driveAccessToken: "drive-token", googleAccount }));
    expect(requestCode).toHaveBeenCalledOnce();
    expect(requestedScope).toContain("https://www.googleapis.com/auth/drive.appdata");
    expect(requestedLoginHint).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith("/api/google/authorize", expect.objectContaining({ method: "POST", credentials: "same-origin" }));
  });

  it("scopes an account hint to one fresh authorization request", async () => {
    const callbacks: Array<(response: { code?: unknown }) => void> = [];
    const requestedLoginHints: Array<string | undefined> = [];
    const services = new GoogleIdentityServices();
    const initCodeClient = vi.fn((config: Parameters<NonNullable<GoogleAccounts["oauth2"]["initCodeClient"]>>[0]) => {
      callbacks.push(config.callback);
      requestedLoginHints.push(config.login_hint);
      return { requestCode: () => config.callback({ code: `code-${callbacks.length}` }) };
    });
    vi.spyOn(services, "loadGoogleAccounts").mockResolvedValue(Result.ok({ oauth2: { initCodeClient } }));
    const googleAccount = { id: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: null };
    const fetch = vi.fn(async () => Response.json({ googleIdToken: "id-token", driveAccessToken: "drive-token", googleAccount }));
    const authorization = new GoogleAuthorizationCode({ clientId: "client-id", googleIdentityServices: services, fetch });
    await authorization.prepare();

    await expect(authorization.request("google-1")).resolves.toEqual(Result.ok({ googleIdToken: "id-token", driveAccessToken: "drive-token", googleAccount }));
    await expect(authorization.request()).resolves.toEqual(Result.ok({ googleIdToken: "id-token", driveAccessToken: "drive-token", googleAccount }));

    expect(initCodeClient).toHaveBeenCalledTimes(2);
    expect(requestedLoginHints).toEqual(["google-1", undefined]);
  });

  it("ignores a callback from a disposed authorization request", async () => {
    const callbacks: Array<(response: { code?: unknown }) => void> = [];
    const services = new GoogleIdentityServices();
    const initCodeClient = vi.fn((config: Parameters<NonNullable<GoogleAccounts["oauth2"]["initCodeClient"]>>[0]) => {
      callbacks.push(config.callback);
      return { requestCode: vi.fn() };
    });
    vi.spyOn(services, "loadGoogleAccounts").mockResolvedValue(Result.ok({ oauth2: { initCodeClient } }));
    const googleAccount = { id: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: null };
    const fetch = vi.fn(async () => Response.json({ googleIdToken: "id-token", driveAccessToken: "drive-token", googleAccount }));
    const authorization = new GoogleAuthorizationCode({ clientId: "client-id", googleIdentityServices: services, fetch });
    await authorization.prepare();

    const disposedRequest = authorization.request("google-1");
    authorization.dispose();
    const disposedResult = await disposedRequest;
    expect(Result.isError(disposedResult)).toBe(true);
    if (Result.isError(disposedResult)) expect(disposedResult.error).toEqual({ code: "google_authorization_failed" });
    await authorization.prepare();
    const activeRequest = authorization.request();

    callbacks[0]?.({ code: "stale-code" });
    expect(fetch).not.toHaveBeenCalled();
    callbacks[1]?.({ code: "active-code" });
    await expect(activeRequest).resolves.toEqual(Result.ok({ googleIdToken: "id-token", driveAccessToken: "drive-token", googleAccount }));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("aborts an in-flight exchange without affecting the next request", async () => {
    const callbacks: Array<(response: { code?: unknown }) => void> = [];
    const services = new GoogleIdentityServices();
    const initCodeClient = vi.fn((config: Parameters<NonNullable<GoogleAccounts["oauth2"]["initCodeClient"]>>[0]) => {
      callbacks.push(config.callback);
      return { requestCode: vi.fn() };
    });
    vi.spyOn(services, "loadGoogleAccounts").mockResolvedValue(Result.ok({ oauth2: { initCodeClient } }));
    const googleAccount = { id: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: null };
    let resolveFirstExchange: ((response: Response) => void) | undefined;
    const exchangeSignals: AbortSignal[] = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) exchangeSignals.push(init.signal);
      if (fetch.mock.calls.length === 1) {
        return new Promise<Response>((resolve) => { resolveFirstExchange = resolve; });
      }
      return Response.json({ googleIdToken: "id-token", driveAccessToken: "drive-token", googleAccount });
    });
    const authorization = new GoogleAuthorizationCode({ clientId: "client-id", googleIdentityServices: services, fetch });
    await authorization.prepare();

    const disposedRequest = authorization.request("google-1");
    callbacks[0]?.({ code: "disposed-code" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    authorization.dispose();
    expect(exchangeSignals[0]?.aborted).toBe(true);
    await disposedRequest;

    await authorization.prepare();
    const activeRequest = authorization.request();
    resolveFirstExchange?.(Response.json({ googleIdToken: "stale", driveAccessToken: "stale", googleAccount }));
    callbacks[1]?.({ code: "active-code" });

    await expect(activeRequest).resolves.toEqual(Result.ok({ googleIdToken: "id-token", driveAccessToken: "drive-token", googleAccount }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
