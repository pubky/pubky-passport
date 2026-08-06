import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { GoogleAuthorizationCodeExchange } from "./googleAuthorizationCodeExchange";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

describe("GoogleAuthorizationCodeExchange", () => {
  it("exchanges a one-time code without exposing the client secret", async () => {
    let requestBody = "";
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("userinfo")) return Response.json({ sub: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", picture: "https://lh3.googleusercontent.com/avatar" });
      if (String(url).includes("googleusercontent.com")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
      requestBody = String(init?.body);
      return Response.json({ access_token: "drive-token", id_token: "id-token", scope: `openid ${DRIVE_SCOPE}` });
    });
    const exchange = new GoogleAuthorizationCodeExchange({ clientId: "client-id", clientSecret: "client-secret", fetch });

    await expect(exchange.exchange("one-time-code", "https://passport.example")).resolves.toEqual(Result.ok({
      driveAccessToken: "drive-token",
      googleIdToken: "id-token",
      googleAccount: { id: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: "data:image/png;base64,AQID" },
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
