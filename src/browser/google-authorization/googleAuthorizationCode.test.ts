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
    const initCodeClient = vi.fn((config: Parameters<NonNullable<GoogleAccounts["oauth2"]["initCodeClient"]>>[0]) => { callback = config.callback; requestedScope = config.scope; return { requestCode }; });
    vi.spyOn(services, "loadGoogleAccounts").mockResolvedValue(Result.ok({
      oauth2: { initCodeClient },
    }));
    const fetch = vi.fn(async () => Response.json({ googleIdToken: "id-token", driveAccessToken: "drive-token" }));
    const authorization = new GoogleAuthorizationCode({ clientId: "client-id", googleIdentityServices: services, fetch });

    await expect(authorization.prepare()).resolves.toEqual(Result.ok());
    await expect(authorization.request()).resolves.toEqual(Result.ok({ googleIdToken: "id-token", driveAccessToken: "drive-token" }));
    expect(requestCode).toHaveBeenCalledOnce();
    expect(requestedScope).toContain("https://www.googleapis.com/auth/drive.appdata");
    expect(fetch).toHaveBeenCalledWith("/api/google/authorize", expect.objectContaining({ method: "POST", credentials: "same-origin" }));
  });
});
