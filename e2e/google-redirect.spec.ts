import { expect, test, type BrowserContext } from "@playwright/test";

const STORAGE_KEY = "pubky-passport/google-redirect/v1";
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
const REQUEST = `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=${SECRET}&x-source=Client&x-cancel=https%3A%2F%2Fclient.example%2Fcancel`;
const ENTRY = `/authorize#d=${encodeURIComponent(REQUEST)}`;

async function google(
  context: BrowserContext,
  options: { denied?: boolean; wrongState?: boolean } = {},
) {
  const requests: URL[] = [];
  await context.route("https://accounts.google.com/o/oauth2/v2/auth**", async (route) => {
    const request = new URL(route.request().url());
    requests.push(request);
    const response = new URL(request.searchParams.get("redirect_uri")!);
    const claims = Buffer.from(
      JSON.stringify({ sub: "google-redirect-user", nonce: request.searchParams.get("nonce") }),
    ).toString("base64url");
    response.hash = new URLSearchParams({
      state: options.wrongState ? "wrong" : request.searchParams.get("state")!,
      ...(options.denied
        ? { error: "access_denied" }
        : {
            access_token: "redirect-access-canary",
            id_token: `header.${claims}.signature`,
            scope: "openid email profile https://www.googleapis.com/auth/drive.appdata",
            expires_in: "3600",
          }),
    }).toString();
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><script>location.replace(${JSON.stringify(response.href)})</script>`,
    });
  });
  await context.route("https://openidconnect.googleapis.com/v1/userinfo", (route) =>
    route.fulfill({
      json: { sub: "google-redirect-user", email: "test@example.com", name: "Test" },
    }),
  );
  await context.route("https://www.googleapis.com/drive/v3/files**", (route) =>
    route.fulfill({ json: { files: [] } }),
  );
  await context.route("https://client.example/cancel", (route) =>
    route.fulfill({ contentType: "text/html", body: "Cancelled" }),
  );
  return requests;
}

test("automatically signs in in the same tab and restores the requesting app", async ({
  context,
  page,
}) => {
  const requests = await google(context);
  // Prove the flow works even when window.open is unavailable.
  await page.addInitScript(() => {
    window.open = () => {
      throw new Error("No popups allowed");
    };
  });
  await page.goto(ENTRY);
  await expect(page.getByRole("heading", { name: "Drive access optional." })).toBeVisible();
  await expect(page.getByLabel("Signing in to client.example")).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(context.pages()).toHaveLength(1);
  expect(requests[0]!.href).not.toContain(SECRET);
  expect(new URL(page.url()).hash).toBe("");
  expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)).toBeNull();
  const storage = await page.evaluate(() =>
    JSON.stringify([localStorage, sessionStorage, history.state]),
  );
  expect(storage).not.toContain("redirect-access-canary");
  expect(storage).not.toContain(SECRET);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL("https://client.example/cancel");
});

test("Google cancellation stays retryable without an automatic redirect loop", async ({
  context,
  page,
}) => {
  const requests = await google(context, { denied: true });
  await page.goto(ENTRY);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(context.pages()).toHaveLength(1);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(requests[0]!.searchParams.get("state")).not.toBe(requests[1]!.searchParams.get("state"));
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL("https://client.example/cancel");
});

test("rejects a mismatched OAuth state without calling Google UserInfo", async ({
  context,
  page,
}) => {
  await google(context, { wrongState: true });
  const profileRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/v1/userinfo")) profileRequests.push(request.url());
  });
  await page.goto(ENTRY);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(profileRequests).toEqual([]);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)).toBeNull();
});

test("blocked session storage produces a retryable error without leaving Passport", async ({
  context,
  page,
}) => {
  const requests = await google(context);
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  });
  await page.goto(ENTRY);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(requests).toHaveLength(0);
  expect(new URL(page.url()).pathname).toBe("/authorize");
});

test("a single Passport popup navigates through Google without a nested popup", async ({
  context,
  page,
}) => {
  await google(context);
  await page.goto("/");
  const popupPromise = page.waitForEvent("popup");
  // The initial popup is the client's responsibility; Passport opens no further windows.
  await page.evaluate((entry) => {
    const button = document.createElement("button");
    button.textContent = "Open Passport";
    button.onclick = () => window.open(entry, "passport", "popup,width=520,height=760");
    document.body.append(button);
  }, ENTRY);
  await page.getByRole("button", { name: "Open Passport" }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole("heading", { name: "Drive access optional." })).toBeVisible();
  expect(context.pages()).toHaveLength(2);
  await popup.getByRole("button", { name: "Back", exact: true }).click();
  await expect(popup).toHaveURL("https://client.example/cancel");
});
