import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { GoogleAuthorizationCodeExchange } from "./googleAuthorizationCodeExchange";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

describe("GoogleAuthorizationCodeExchange", () => {
  it("exchanges a one-time code without exposing the client secret", async () => {
    let requestBody = "";
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body);
      return Response.json({ access_token: "drive-token", id_token: "id-token", scope: `openid ${DRIVE_SCOPE}` });
    });
    const exchange = new GoogleAuthorizationCodeExchange({ clientId: "client-id", clientSecret: "client-secret", fetch });

    await expect(exchange.exchange("one-time-code", "https://passport.example")).resolves.toEqual(Result.ok({
      driveAccessToken: "drive-token",
      googleIdToken: "id-token",
    }));
    expect(new URLSearchParams(requestBody).get("redirect_uri")).toBe("https://passport.example");
    expect(new URLSearchParams(requestBody).get("client_secret")).toBe("client-secret");
  });

  it("rejects a token response without Drive app-data consent", async () => {
    const exchange = new GoogleAuthorizationCodeExchange({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: vi.fn(async () => Response.json({ access_token: "drive-token", id_token: "id-token", scope: "openid" })),
    });
    const result = await exchange.exchange("code", "https://passport.example");
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "authorization_failed" });
  });
});
