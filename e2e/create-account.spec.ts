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

async function expectInvite(page: Page) {
  await expect(page).toHaveURL(/^https:\/\/app\.example\/return#/);
  const values = Object.fromEntries(new URLSearchParams(new URL(page.url()).hash.slice(1)));
  expect(values).toEqual({ hs: HOMESERVER, st: "invite-token", state: STATE });
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

test("SMS validates the code and returns the invite automatically", async ({ page }) => {
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
  await expectInvite(page);
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

test("Lightning shows the invoice and returns an invite after payment", async ({ page }) => {
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
  await expect(page.getByLabel("Lightning invoice", { exact: true })).toHaveValue(
    "lnbc100n1example",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  paid = true;
  await expectInvite(page);
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
  await expectInvite(page);
});

test("a popup returns an invite to its opener and waits for acknowledgement", async ({
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
        if (data.type !== 'pubky-passport.signup-invite' || data.state !== ${JSON.stringify(STATE)}) return;
        document.getElementById('result').textContent = JSON.stringify(data);
        popup.postMessage({ type: 'pubky-passport.signup-invite-ack', version: 1, messageId: data.messageId }, event.origin);
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
  await expect(page.locator("#result")).toContainText('"st":"invite-token"');
  await expect.poll(() => popup.isClosed()).toBe(true);
  const message = JSON.parse(await page.locator("#result").innerText());
  expect(Object.keys(message).sort()).toEqual([
    "hs",
    "messageId",
    "st",
    "state",
    "type",
    "version",
  ]);
});

test("a standalone visit explains how to start invite signup from a client", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("homegate.example")) requests.push(request.url());
  });
  await page.goto("/create-account");
  await page.getByRole("button", { name: "Continue with SMS" }).click();
  await expect(page.getByRole("heading", { name: "Start from your app." })).toBeVisible();
  expect(requests).toEqual([]);
});

test("the create-account entry rejects grant secrets", async ({ page }) => {
  await page.goto("/create-account#d=pubkyauth%3A%2F%2Fsignup_grant%3Fsecret%3Dsecret-canary");
  await expect(page.getByRole("heading", { name: "Unable to continue." })).toBeVisible();
  await expect(page).toHaveURL(/\/create-account$/);
  await expect(page.locator("body")).not.toContainText("secret-canary");
});
