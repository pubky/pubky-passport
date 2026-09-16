import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const HOMESERVER = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const ID = "550e8400-e29b-41d4-a716-446655440000";
const STATE = "test_signup_state_1234";
const CALLBACK = "https://app.example/return";
const ENTRY = `/create-account#${new URLSearchParams({ callback: CALLBACK, state: STATE })}`;

async function mockCallback(page: Page) {
  await page.route(`${CALLBACK}**`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Back in your app</h1>" }),
  );
}

async function expectCompletion(page: Page) {
  await expect(page).toHaveURL(/^https:\/\/app\.example\/return#/);
  const values = Object.fromEntries(new URLSearchParams(new URL(page.url()).hash.slice(1)));
  expect(values).toEqual({ signup: "complete", state: STATE });
}

async function finishInRing(page: Page) {
  await expect(page.getByRole("heading", { name: "Scan QR Code." })).toBeVisible();
  await expect(page).toHaveURL(/\/create-account$/);
  const showQr = page.getByRole("button", { name: "Show signup QR" });
  if (await showQr.isVisible()) await showQr.click();
  await expect(page.getByRole("img", { name: "Pubky Ring signup QR code" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to sign in" })).toBeEnabled();
  await page.getByRole("button", { name: "Continue to sign in" }).click();
}

test("create-account adds methods without changing the start or authorize screens", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Quick & easy signing." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with (SMS|Lightning)/ })).toHaveCount(0);
  await page.goto("/authorize");
  await expect(page.getByRole("heading", { name: "Authorize a service." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with (SMS|Lightning)/ })).toHaveCount(0);
  await page.goto(ENTRY);
  await expect(page.getByRole("heading", { name: "Create your account." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with SMS" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Continue with Lightning" })).toBeEnabled();
  await expect(page).toHaveURL(/\/create-account$/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("SMS validates the code and keeps signup in Passport until the user continues", async ({
  page,
}) => {
  await mockCallback(page);
  await page.route("https://homegate.example/sms_verification/send_code", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ phoneNumber: "+41791234567" });
    await route.fulfill({ status: 200, body: "" });
  });
  await page.route("https://homegate.example/sms_verification/validate_code", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      json:
        body.code === "123456"
          ? { valid: "true", signupCode: "invite-token", homeserverPubky: HOMESERVER }
          : { valid: "false" },
    });
  });
  await page.goto(ENTRY);
  await page.getByRole("button", { name: "Continue with SMS" }).click();
  await expect(page.getByRole("button", { name: "Send verification code" })).toBeDisabled();
  await page.getByLabel("Phone number", { exact: true }).fill("+41 79 123 45 67");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Send verification code" }).click();
  await expect(page.getByRole("heading", { name: "Check your messages." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Resend code in/ })).toBeDisabled();
  await page.getByLabel("Verification code", { exact: true }).fill("000000");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("That code is incorrect");
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await finishInRing(page);
  await expectCompletion(page);
});

test("SMS reports provider limits and lets the user choose another method", async ({ page }) => {
  await page.route("https://homegate.example/sms_verification/send_code", (route) =>
    route.fulfill({ status: 429, body: "Phone number has exceeded weekly verification limit" }),
  );
  await page.goto(ENTRY);
  await page.getByRole("button", { name: "Continue with SMS" }).click();
  await page.getByLabel("Phone number", { exact: true }).fill("+41791234567");
  await page.getByRole("button", { name: "Send verification code" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("weekly signup limit");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue with Lightning" })).toBeVisible();
});

test("Lightning shows the invoice and shows Ring signup after payment", async ({ page }) => {
  await mockCallback(page);
  let paid = false;
  await page.route("https://homegate.example/ln_verification", (route) =>
    route.fulfill({
      json: {
        id: ID,
        amountSat: 100,
        expiresAt: Date.now() + 60_000,
        bolt11Invoice: "lnbc100n1example",
      },
    }),
  );
  await page.route(`https://homegate.example/ln_verification/${ID}`, (route) =>
    route.fulfill({
      json: {
        id: ID,
        isPaid: paid,
        signupCode: paid ? "invite-token" : null,
        homeserverPubky: HOMESERVER,
      },
    }),
  );
  await page.goto(ENTRY);
  await page.getByRole("button", { name: "Continue with Lightning" }).click();
  await expect(page.getByText("100 sats", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Lightning wallet" })).toHaveAttribute(
    "href",
    "lightning:lnbc100n1example",
  );
  await expect(page.getByText("lnbc100n1example", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy Lightning invoice" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Waiting for payment" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  paid = true;
  await finishInRing(page);
  await expectCompletion(page);
});

test("expired invoices hide payment actions and allow checking a late payment", async ({
  page,
}) => {
  await mockCallback(page);
  let paid = false;
  await page.route("https://homegate.example/ln_verification", (route) =>
    route.fulfill({
      json: {
        id: ID,
        amountSat: 100,
        expiresAt: Date.now() + 500,
        bolt11Invoice: "lnbc100n1example",
      },
    }),
  );
  await page.route(`https://homegate.example/ln_verification/${ID}`, (route) =>
    route.fulfill({
      json: {
        id: ID,
        isPaid: paid,
        signupCode: paid ? "invite-token" : null,
        homeserverPubky: HOMESERVER,
      },
    }),
  );
  await page.goto(ENTRY);
  await page.getByRole("button", { name: "Continue with Lightning" }).click();
  await expect(page.getByRole("button", { name: "Check payment", exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("link", { name: "Open Lightning wallet" })).toHaveCount(0);
  paid = true;
  await page.getByRole("button", { name: "Check payment", exact: true }).click();
  await finishInRing(page);
  await expectCompletion(page);
});

test("a popup returns completion to its opener and waits for acknowledgement", async ({
  page,
  baseURL,
}) => {
  await page.route("https://app.example/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `
    <button id="start">Create account</button><p id="result"></p>
    <script>
      let popup;
      document.getElementById('start').onclick = () => { popup = window.open(${JSON.stringify(`${baseURL}${ENTRY}`)}, 'passport'); };
      addEventListener('message', event => {
        if (event.origin !== ${JSON.stringify(baseURL)} || event.source !== popup) return;
        const data = event.data;
        if (data.type !== 'pubky-passport.signup-complete' || data.state !== ${JSON.stringify(STATE)}) return;
        document.getElementById('result').textContent = JSON.stringify(data);
        popup.postMessage({ type: 'pubky-passport.signup-complete-ack', version: 1, messageId: data.messageId }, event.origin);
      });
    </script>`,
    }),
  );
  await page
    .context()
    .route("https://homegate.example/sms_verification/send_code", (route) =>
      route.fulfill({ status: 200, body: "" }),
    );
  await page.context().route("https://homegate.example/sms_verification/validate_code", (route) =>
    route.fulfill({
      json: { valid: "true", signupCode: "invite-token", homeserverPubky: HOMESERVER },
    }),
  );
  await page.goto("https://app.example/");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Create account" }).click();
  const popup = await popupPromise;
  await popup.getByRole("button", { name: "Continue with SMS" }).click();
  await popup.getByLabel("Phone number", { exact: true }).fill("+41791234567");
  await popup.getByRole("button", { name: "Send verification code" }).click();
  await popup.getByLabel("Verification code", { exact: true }).fill("123456");
  await popup.getByRole("button", { name: "Verify and continue" }).click();
  await finishInRing(popup);
  await expect(page.locator("#result")).toContainText('"type":"pubky-passport.signup-complete"');
  await expect.poll(() => popup.isClosed()).toBe(true);
  const message = JSON.parse(await page.locator("#result").innerText());
  expect(Object.keys(message).sort()).toEqual(["messageId", "state", "type", "version"]);
});

test("standalone signup shows Ring instructions without requiring a client", async ({ page }) => {
  await page.route("https://homegate.example/sms_verification/send_code", (route) =>
    route.fulfill({ status: 200, body: "" }),
  );
  await page.route("https://homegate.example/sms_verification/validate_code", (route) =>
    route.fulfill({
      json: { valid: "true", signupCode: "invite-token", homeserverPubky: HOMESERVER },
    }),
  );
  await page.goto("/create-account");
  await page.getByRole("button", { name: "Continue with SMS" }).click();
  await page.getByLabel("Phone number", { exact: true }).fill("+41791234567");
  await page.getByRole("button", { name: "Send verification code" }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("heading", { name: "Scan QR Code." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to sign in" })).toHaveCount(0);
  await page.getByRole("button", { name: "Need to install Pubky Ring?" }).click();
  await expect(page.getByRole("heading", { name: "Install Pubky Ring." })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download Pubky Ring on the App Store" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue with Pubky Ring" }).click();
  await expect(page.getByRole("heading", { name: "Scan QR Code." })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the create-account entry rejects grant secrets", async ({ page }) => {
  await page.goto("/create-account#d=pubkyauth%3A%2F%2Fsignup_grant%3Fsecret%3Dsecret-canary");
  await expect(page.getByRole("heading", { name: "Unable to continue." })).toBeVisible();
  await expect(page).toHaveURL(/\/create-account$/);
  await expect(page.locator("body")).not.toContainText("secret-canary");
});
