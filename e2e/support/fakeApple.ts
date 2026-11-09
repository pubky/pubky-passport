import { createHash } from "node:crypto";
import type { BrowserContext, Request } from "@playwright/test";

/**
 * Stand-ins for Apple's sign-in popup, iCloud's sign-in popup and the CloudKit web API, served
 * through Playwright routes. Like CloudKit, `users/caller` answers 421 with a sign-in URL until
 * a session arrives as `ckWebAuthToken`, so tests can check where that token travels.
 */
export const APPLE_AUTHORIZE = "https://appleid.apple.com/auth/authorize";
export const CLOUDKIT_SESSION = "E2E-CLOUDKIT-SESSION-TOKEN";
export const APPLE_SUBJECT = "001234.e2e0subject0.1234";
/** A private relay address, as Apple gives when the user hides their email. */
export const APPLE_EMAIL = "e2e0relay@privaterelay.appleid.com";
export const APPLE_FIRST_NAME = "Jane";
export const APPLE_LAST_NAME = "Appleseed";

export type StoredRecord = {
  recordName: string;
  recordType: string;
  recordChangeTag: string;
  fields: Record<string, { value: string }>;
};

export type FakeAppleOptions = {
  records?: Map<string, StoredRecord>;
  homegate?: "ok" | "unavailable";
  closeAfterApple?: boolean;
  holdApple?: boolean;
  holdICloud?: boolean;
  icloudError?: "accessError" | "unknownError" | "window closed";
};

export function appleSubjectHash(subject = APPLE_SUBJECT): string {
  return createHash("sha256").update(`pubky-passport/apple-sub/v1\n${subject}`).digest("base64url");
}

export async function installFakeApple(context: BrowserContext, options: FakeAppleOptions = {}) {
  const records = options.records ?? new Map<string, StoredRecord>();
  const requests: Request[] = [];
  const wrappingKeyBodies: unknown[] = [];
  const homegateBodies: unknown[] = [];
  const cloudKitCalls: { url: string; body: unknown }[] = [];
  let changeTag = 0;

  context.on("request", (request) => requests.push(request));

  await context.route(`${APPLE_AUTHORIZE}?**`, (route) => {
    const request = new URL(route.request().url());
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const scopes = (request.searchParams.get("scope") ?? "").split(" ");
    const claims = {
      iss: "https://appleid.apple.com",
      aud: request.searchParams.get("client_id"),
      sub: APPLE_SUBJECT,
      nonce: request.searchParams.get("nonce"),
      iat: now,
      exp: now + 600,
      ...(scopes.includes("email")
        ? { email: APPLE_EMAIL, email_verified: "true", is_private_email: "true" }
        : {}),
    };
    const message = {
      method: "oauthDone",
      data: {
        authorization: {
          state: request.searchParams.get("state"),
          code: "e2e-code",
          id_token: `${encode({ alg: "RS256", kid: "e2e" })}.${encode(claims)}.c2ln`,
        },
        // Apple sends the user object only on the first authorization; this stand-in always does.
        ...(scopes.includes("name")
          ? {
              user: {
                name: { firstName: APPLE_FIRST_NAME, lastName: APPLE_LAST_NAME },
                email: APPLE_EMAIL,
              },
            }
          : {}),
      },
    };
    return route.fulfill({
      contentType: "text/html",
      body: options.holdApple
        ? "<!doctype html><h1>Sign in with Apple</h1>"
        : `<!doctype html><script>opener.postMessage(${JSON.stringify(JSON.stringify(message))}, "*");${options.closeAfterApple ? "close();" : ""}</script>`,
    });
  });
  await context.route("https://idmsa.apple.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><script>location.replace("https://cdn.apple-cloudkit.com/ck-auth/?stub=1")</script>',
    }),
  );
  await context.route("https://cdn.apple-cloudkit.com/ck-auth/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: options.holdICloud
        ? "<!doctype html><h1>Allow iCloud</h1>"
        : `<!doctype html><script>setTimeout(() => { opener.postMessage(${JSON.stringify(options.icloudError ? { errorMessage: options.icloudError } : { ckSession: CLOUDKIT_SESSION })}, "*"); ${options.icloudError ? "" : "setTimeout(() => close(), 50);"} }, 400);</script>`,
    }),
  );
  await context.route("https://api.apple-cloudkit.com/**", async (route) => {
    const url = new URL(route.request().url());
    const postData = route.request().postData();
    const body: unknown = postData ? JSON.parse(postData) : undefined;
    cloudKitCalls.push({ url: url.href, body });
    if (url.pathname.endsWith("/public/users/caller")) {
      return url.searchParams.get("ckWebAuthToken") === CLOUDKIT_SESSION
        ? route.fulfill({ json: { userRecordName: "_e2e" } })
        : route.fulfill({
            status: 421,
            json: {
              serverErrorCode: "AUTHENTICATION_REQUIRED",
              redirectURL: "https://idmsa.apple.com/IDMSWebAuth/signin?e2e=1",
            },
          });
    }
    if (url.searchParams.get("ckWebAuthToken") !== CLOUDKIT_SESSION) {
      return route.fulfill({ status: 401, json: { serverErrorCode: "AUTHENTICATION_REQUIRED" } });
    }
    if (url.pathname.endsWith("/records/lookup")) {
      const names = (body as { records: { recordName: string }[] }).records;
      return route.fulfill({
        json: {
          records: names.map(
            ({ recordName }) =>
              records.get(recordName) ?? { recordName, serverErrorCode: "NOT_FOUND" },
          ),
        },
      });
    }
    if (url.pathname.endsWith("/records/modify")) {
      const operations = (body as { operations: { operationType: string; record: StoredRecord }[] })
        .operations;
      const results = operations.map(({ operationType, record }) => {
        const existing = records.get(record.recordName);
        if (operationType === "create") {
          if (existing) return { recordName: record.recordName, serverErrorCode: "CONFLICT" };
          const created = { ...record, recordChangeTag: `tag-${++changeTag}` };
          records.set(record.recordName, created);
          return created;
        }
        if (!existing) return { recordName: record.recordName, serverErrorCode: "NOT_FOUND" };
        if (existing.recordChangeTag !== record.recordChangeTag) {
          return { recordName: record.recordName, serverErrorCode: "CONFLICT" };
        }
        records.delete(record.recordName);
        return { recordName: record.recordName, deleted: true };
      });
      return route.fulfill({ json: { records: results } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await context.route("**/api/wrapping-key/apple", async (route) => {
    const body: unknown = route.request().postDataJSON();
    wrappingKeyBodies.push(body);
    return route.fulfill({
      json: {
        wrappingKey: Buffer.alloc(32, 7).toString("base64url"),
        keyId: (body as { keyId?: string }).keyId ?? "e2e",
      },
    });
  });
  await context.route("https://homegate.example/apple_verification", async (route) => {
    homegateBodies.push(route.request().postDataJSON());
    return options.homegate === "unavailable"
      ? route.fulfill({ status: 503, body: "internal_error" })
      : route.fulfill({
          json: {
            signupCode: "e2e-signup-code",
            homeserverPubky: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
          },
        });
  });
  await context.route("https://pkarr.*/**", (route) => route.fulfill({ status: 404 }));

  return { cloudKitCalls, homegateBodies, records, requests, wrappingKeyBodies };
}
