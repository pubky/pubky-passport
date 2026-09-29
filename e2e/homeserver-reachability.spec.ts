import { PKARR_RELAY_HOSTS } from "./helpers/network";
import { expect, test, type Page } from "./helpers/passportTest";
import { HOMESERVER, homeserverRecord, seedProfileIdentity } from "./helpers/pubkyProfile";

const DRAFT_STORAGE_KEY = "pubky-passport/local-account-draft/v1";
const SMS_INVITE = "SMS1-NV1T-C0DE";
const AUTHORIZATION_REQUEST =
  "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-source=Client%20App&x-success=https%3A%2F%2Fclient.example%2Fsuccess&x-error=https%3A%2F%2Fclient.example%2Ferror&x-cancel=https%3A%2F%2Fclient.example%2Fcancel";

/**
 * Serves signed PKARR records for the test identity and homeserver and records every publication
 * once it is answered, `putDelayMs` after it arrives, so a spec can tell whether and when a key's
 * record was written.
 */
async function mockPkarrRelays(page: Page, events: string[], putDelayMs = 0): Promise<void> {
  await page.route(
    (url) => PKARR_RELAY_HOSTS.has(url.hostname),
    async (route) => {
      if (route.request().method() === "PUT") {
        await new Promise((resolve) => setTimeout(resolve, putDelayMs));
        events.push("pkarr-put");
        // A page that navigated away meanwhile has cancelled the request.
        return route.fulfill({ status: 200, body: "" }).catch(() => undefined);
      }
      const body = homeserverRecord(new URL(route.request().url()).pathname.slice(1));
      return route.fulfill(
        body ? { status: 200, body, contentType: "application/octet-stream" } : { status: 404 },
      );
    },
  );
}

async function draftRegistrationStarted(page: Page): Promise<unknown> {
  return page.evaluate(
    (key) =>
      (JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>)
        .registrationStarted,
    DRAFT_STORAGE_KEY,
  );
}

test("local signup sends nothing while its homeserver is unreachable and retries with the same key", async ({
  page,
}) => {
  const events: string[] = [];
  await mockPkarrRelays(page, events);
  // Homegate issues an invite for the test homeserver, whose record places it at homeserver.example.
  await page.route("**/sms_verification/send_code", (route) =>
    route.fulfill({ status: 200, body: "" }),
  );
  await page.route("**/sms_verification/validate_code", (route) =>
    route.fulfill({
      json: { valid: "true", signupCode: SMS_INVITE, homeserverPubky: HOMESERVER },
    }),
  );
  let homeserverUp = false;
  await page.route("https://homeserver.example/**", async (route) => {
    const url = new URL(route.request().url());
    const lookup = url.pathname.startsWith("/signup_tokens/");
    if (!lookup) events.push(`homeserver:${route.request().method()} ${url.pathname}`);
    if (!homeserverUp) return route.abort("connectionrefused");
    if (lookup) return route.fulfill({ json: { status: "valid" } });
    // The signup stays pending, so the attempt remains in progress once it was submitted.
    return undefined;
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("button", { name: "Continue with SMS" }).click();
  await page.getByLabel("Phone number", { exact: true }).fill("+41791234567");
  await page.getByRole("button", { name: "Send Code" }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify Code" }).click();
  await page.getByRole("button", { name: /Keep in Passport/u }).click();
  await page.getByLabel("Enter strong password").fill("correct horse");
  await page.getByLabel("Confirm password").fill("correct horse");
  await page.getByRole("button", { name: "Download encrypted backup" }).click();
  await page.getByRole("button", { name: "Skip this check (not recommended)" }).click();

  const interrupted = page.getByRole("heading", { name: "Setup interrupted." });
  await expect(interrupted).toBeVisible({ timeout: 15_000 });
  // The failure screen focuses its heading, which is described by the cause.
  await expect(interrupted).toBeFocused();
  await expect(interrupted).toHaveAccessibleDescription(
    /could not reach this invite's homeserver, so nothing was submitted/u,
  );
  // Only the read-only invite lookup was tried: no signup, no record, and the invite stays unsubmitted.
  expect(events).toEqual([]);
  expect(await draftRegistrationStarted(page)).toBeUndefined();

  homeserverUp = true;
  await page.getByRole("button", { name: "Retry with this key" }).click();
  await expect(page.getByRole("heading", { name: "Setting up your pubky." })).toBeVisible();
  await expect.poll(() => events).toContain("homeserver:POST /auth/grant/signup");
  expect(await draftRegistrationStarted(page)).toBe(true);
});

test("approval republishes the homeserver record before returning to the app", async ({ page }) => {
  const events: string[] = [];
  await seedProfileIdentity(page, false);
  // Slow relays: the republish finishes well after the approval reached the app's relay.
  await mockPkarrRelays(page, events, 500);
  await page.route("https://homeserver.example/**", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.route("https://relay.client.example/**", (route) => {
    events.push(`relay-${route.request().method().toLowerCase()}`);
    return route.fulfill({ status: 200, body: "" });
  });
  await page.route("https://client.example/**", (route) => {
    events.push("callback");
    return route.fulfill({
      body: "<!doctype html><title>Returned</title><h1>Returned to app</h1>",
      contentType: "text/html",
    });
  });

  await page.goto(`/authorize#d=${encodeURIComponent(AUTHORIZATION_REQUEST)}`);
  // The request opens on its identity list; choosing the identity opens its review.
  await page
    .getByRole("list", { name: "Choose the identity to sign in with." })
    .getByRole("button")
    .click();
  await page.getByRole("button", { name: "Authorize", exact: true }).click();

  await expect(page).toHaveURL(/^https:\/\/client\.example\/success/u);
  const callback = events.indexOf("callback");
  expect(events.indexOf("relay-post")).toBeGreaterThanOrEqual(0);
  expect(events.indexOf("relay-post")).toBeLessThan(callback);
  // The republished record was stored before the app took over the page.
  expect(events.slice(0, callback)).toContain("pkarr-put");
});
