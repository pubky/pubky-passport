import type { BrowserContext } from "@playwright/test";

import { E2E_PORT } from "./e2eServer";
import { PKARR_RELAY_HOSTS } from "./network";
import { HOMESERVER, homeserverRecord } from "./pubkyProfile";

/**
 * A Passport file names an HTTPS origin, so creating a Google identity runs here, an origin every
 * request of which is answered by the e2e server.
 */
export const SECURE_ORIGIN = "https://passport.test";

/**
 * Plays the network for creating an identity with Google on {@link SECURE_ORIGIN}: Google grants
 * only the first Drive permission, Drive starts empty, Passport's server and Homegate answer, and
 * the test homeserver accepts the signup and signs the new key in.
 */
export async function mockGoogleCreation(
  context: BrowserContext,
  account: { googleSubject: string; email: string; name: string },
): Promise<URL[]> {
  /** Every authorization request Passport sent to Google, to inspect what it carried. */
  const googleRequests: URL[] = [];
  await context.route(`${SECURE_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/wrapping-key/google") {
      return route.fulfill({
        json: { wrappingKey: Buffer.alloc(32, 7).toString("base64url"), keyId: "e2e" },
      });
    }
    const response = await route.fetch({
      url: `http://127.0.0.1:${E2E_PORT}${url.pathname}${url.search}`,
      maxRedirects: 0,
    });
    return route.fulfill({ response });
  });
  await context.route("https://accounts.google.com/o/oauth2/v2/auth**", (route) => {
    const request = new URL(route.request().url());
    googleRequests.push(request);
    const claims = Buffer.from(
      JSON.stringify({
        sub: account.googleSubject,
        nonce: request.searchParams.get("nonce"),
      }),
    ).toString("base64url");
    const callback = new URL(request.searchParams.get("redirect_uri")!);
    callback.hash = new URLSearchParams({
      access_token: "e2e-drive-token",
      id_token: `header.${claims}.signature`,
      state: request.searchParams.get("state")!,
      scope: "openid email profile https://www.googleapis.com/auth/drive.appdata",
      expires_in: "3600",
    }).toString();
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><script>location.replace(${JSON.stringify(callback.href)})</script>`,
    });
  });
  await context.route("https://openidconnect.googleapis.com/v1/userinfo", (route) =>
    route.fulfill({
      json: {
        sub: account.googleSubject,
        email: account.email,
        name: account.name,
      },
    }),
  );
  // Drive holds nothing until Passport uploads its file, which later lists then return.
  const driveFiles: { id: string; name: string; version: string }[] = [];
  await context.route("https://www.googleapis.com/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/upload/drive/v3/files") {
      const file = { id: "passport-file", name: "passport.json", version: "1" };
      driveFiles.push(file);
      return route.fulfill({ json: file });
    }
    return route.fulfill({ json: { files: driveFiles } });
  });
  await context.route("**/google_verification", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ json: { signupCode: "G00G-1E51-GNVP", homeserverPubky: HOMESERVER } })
      : route.fallback(),
  );
  // Records published for the new key are served back to later lookups.
  const published = new Map<string, Buffer>();
  await context.route(
    (url) => PKARR_RELAY_HOSTS.has(url.hostname),
    (route) => {
      const key = new URL(route.request().url()).pathname.slice(1);
      if (route.request().method() !== "GET") {
        const record = route.request().postDataBuffer();
        if (record) published.set(key, record);
        return route.fulfill({ status: 200, body: "" });
      }
      const body = published.get(key) ?? homeserverRecord(key);
      return route.fulfill(
        body ? { status: 200, body, contentType: "application/octet-stream" } : { status: 404 },
      );
    },
  );
  await context.route("https://homeserver.example/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith("/signup_tokens/")) return route.fallback();
    if (url.pathname === "/auth/grant/session" && request.method() === "POST") {
      const { grant } = request.postDataJSON() as { grant: string };
      const claims = JSON.parse(
        Buffer.from(grant.split(".")[1]!, "base64url").toString("utf8"),
      ) as { iss: string; client_id: string; caps: string[]; jti: string; exp: number };
      const now = Math.floor(Date.now() / 1000);
      return route.fulfill({
        json: {
          token: "e2e-bearer",
          session: {
            homeserver: HOMESERVER,
            pubky: claims.iss,
            client_id: claims.client_id,
            capabilities: claims.caps,
            grant_id: claims.jti,
            token_expires_at: now + 3_600,
            grant_expires_at: claims.exp,
            created_at: now,
          },
        },
      });
    }
    return route.fulfill({ status: request.method() === "GET" ? 404 : 200, body: "" });
  });
  return googleRequests;
}
