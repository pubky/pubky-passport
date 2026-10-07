import {
  NAME_IN_REQUEST,
  UNVERIFIED_BAND,
  UNVERIFIED_HEADING,
  UNVERIFIED_WARNING,
  nameInRequest,
} from "./helpers/requester";
import { USE_DEV_SERVER } from "./helpers/e2eServer";
import { expect, test, type Page } from "./helpers/passportTest";

const SENSITIVE_SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
const RELAY_ORIGIN = "https://relay.client.example";
const RELAY_PATH_CANARY = "private-inbox";
const CALLBACK_QUERY_CANARY = "session=sensitive";
const SOURCE_NAME = "Client App";
const GRANT_CLIENT_ID = "grant-client.example";
const GRANT_CLIENT_PUBLIC_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const SENSITIVE_CANARIES = [
  SENSITIVE_SECRET,
  RELAY_PATH_CANARY,
  CALLBACK_QUERY_CANARY,
  GRANT_CLIENT_ID,
  GRANT_CLIENT_PUBLIC_KEY,
];
const LOCAL_IDENTITY_PUBLIC_KEY = "tkrq8zmwb8a3m9k15csu3q17qmfgqnp9dskbrg9uq1rydpyxp7qy";
const LOCAL_IDENTITY_STORAGE_KEY = `pubky-passport/local-identities/v1/identity/${LOCAL_IDENTITY_PUBLIC_KEY}`;
const LOCAL_IDENTITY_STORAGE_VALUE = JSON.stringify({
  v: 1,
  publicKeyZ32: LOCAL_IDENTITY_PUBLIC_KEY,
  secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
});
const LOCAL_IDENTITY_STORAGE = {
  [LOCAL_IDENTITY_STORAGE_KEY]: LOCAL_IDENTITY_STORAGE_VALUE,
  "pubky-passport/local-identities/v1/active": LOCAL_IDENTITY_PUBLIC_KEY,
};

test("shows shared onboarding when no request was supplied", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import it" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Create account" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Pubky Ring", exact: true })).toBeVisible();
});

test("shows identity setup context as the designed full-width accent band", async ({ page }) => {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    // A fresh document each time: the same entry URL again would reload the open page mid-check.
    await page.goto("about:blank");
    await page.goto(authorizationUrl(authorizationRequest(`${RELAY_ORIGIN}/inbox`)));

    // M3: a plain link names nobody; the band says so, with where the request returns.
    const band = page.getByRole("complementary", UNVERIFIED_BAND);
    const logo = page.getByRole("img", { name: "Pubky", exact: true });
    const main = page.locator("main");
    await expect(band).toBeVisible();
    await expect(band.locator(":scope > div:first-child > span > svg")).toHaveAttribute(
      "viewBox",
      "0 0 24 24",
    );
    await expect(band.locator(":scope > div:first-child > span > svg path")).toHaveAttribute(
      "d",
      "M15 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H15M10 7L15 12L10 17M15 12H3",
    );
    await page.evaluate(async () => document.fonts.ready);

    const [bandBox, logoBox, mainBox] = await Promise.all([
      band.boundingBox(),
      logo.boundingBox(),
      main.boundingBox(),
    ]);
    expect(bandBox).not.toBeNull();
    expect(logoBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    expectWithinOnePixel(bandBox?.x ?? -1, 0);
    expectWithinOnePixel(bandBox?.y ?? -1, 0);
    expectWithinOnePixel(bandBox?.width ?? -1, viewport.width);
    // Its first line is the designed 34px; the unverified callback host takes a line under it.
    expect(bandBox?.height ?? -1).toBeGreaterThan(34);
    await expect(band).toContainText("Returns to client.example (unverified)");
    expect(logoBox?.y).toBeGreaterThanOrEqual((bandBox?.y ?? 0) + (bandBox?.height ?? 0));
    expect(mainBox?.y).toBeGreaterThanOrEqual((logoBox?.y ?? 0) + (logoBox?.height ?? 0));
    expect(await band.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("0px");
    expect(await band.evaluate((element) => getComputedStyle(element).color)).toBe(
      "rgb(200, 255, 0)",
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  }
});

test("never names a plain link after its callback domain, without x-source either", async ({
  page,
}) => {
  await installLocalIdentityFixture(page);
  await page.goto(authorizationUrl(authorizationRequest(`${RELAY_ORIGIN}/inbox`, "cookie", null)));
  await expectSavedIdentityReview(page);

  // M3: the callback host is only where the request returns, never who asks.
  await expect(page.getByRole("heading", UNVERIFIED_HEADING)).toBeVisible();
  await expect(page.getByRole("complementary", UNVERIFIED_BAND)).toContainText(
    "Returns to client.example (unverified)",
  );
  await expect(page.getByText(NAME_IN_REQUEST)).toHaveCount(0);
  await expect(page.getByText(UNVERIFIED_WARNING)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Signing in to/u })).toHaveCount(0);
});

test("keeps a long requester name inside the viewport on desktop breakpoints", async ({ page }) => {
  const source = "Extraordinarily Long Requester Application Name For Layout Testing GmbH & Co. KG";
  await installLocalIdentityFixture(page);
  confirmLeaving(page);
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("about:blank");
    await page.goto(
      authorizationUrl(authorizationRequest(`${RELAY_ORIGIN}/inbox`, "cookie", source)),
    );
    await expectSavedIdentityReview(page);

    // The app's own label shows only as its unverified claim, wrapped inside the column.
    await expect(page.getByText(NAME_IN_REQUEST)).toHaveText(nameInRequest(source));
    await page.evaluate(async () => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  }
});

test("names a look-alike callback host in full and keeps its end visible in the band", async ({
  page,
}) => {
  const host = "accounts.google.com.sign-in.secure-verify.attacker.example";
  await installLocalIdentityFixture(page);
  confirmLeaving(page);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("about:blank");
    await page.goto(
      authorizationUrl(
        authorizationRequest(`${RELAY_ORIGIN}/inbox`, "cookie", "Google", {
          callbackOrigin: `https://${host}`,
        }),
      ),
    );
    await expectSavedIdentityReview(page);
    await page.evaluate(async () => document.fonts.ready);

    // M3: neither the label nor the look-alike host names who asks.
    await expect(page.getByRole("heading", UNVERIFIED_HEADING)).toBeVisible();
    await expect(page.getByText(NAME_IN_REQUEST)).toHaveText(nameInRequest("Google"));
    await expect(page.getByText(/^Website:/u)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Authorize", exact: true }),
    ).toHaveAccessibleDescription(UNVERIFIED_WARNING);
    await expect(page.getByText("allow the app to read and update")).toBeVisible();

    // The band shows the whole host, wrapped, as where the request returns, never who asks.
    const band = page.getByRole("complementary", UNVERIFIED_BAND);
    await expect(band).toContainText(`Returns to ${host} (unverified)`);
    const end = await band.getByText(host).evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.right <= document.documentElement.clientWidth + 1;
    });
    expect(end).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  }
});

test("says Passport can't confirm who asks when a request names no website", async ({ page }) => {
  await installLocalIdentityFixture(page);
  await page.goto(
    authorizationUrl(
      authorizationRequest(`${RELAY_ORIGIN}/inbox`, "cookie", "Google", { callbackOrigin: null }),
    ),
  );
  await expectSavedIdentityReview(page);

  await expect(page.getByRole("heading", UNVERIFIED_HEADING)).toBeVisible();
  await expect(page.getByText(NAME_IN_REQUEST)).toHaveText(nameInRequest("Google"));
  await expect(page.getByText(UNVERIFIED_WARNING)).toBeVisible();
  await expect(page.getByText(/^Website:/u)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Authorize", exact: true }),
  ).toHaveAccessibleDescription(UNVERIFIED_WARNING);
});

test("lists requested permissions with spelled-out access and flags broad rows", async ({
  page,
}) => {
  await installLocalIdentityFixture(page);
  await page.goto(
    authorizationUrl(
      authorizationRequest(`${RELAY_ORIGIN}/inbox`, "cookie", SOURCE_NAME, {
        capabilities: "/pub/example.app/:rw,/pub/:r",
      }),
    ),
  );
  await expectSavedIdentityReview(page);

  await expect(page.locator("main").getByRole("alert")).toHaveText(
    "This app asks for all your public data, including the folders other apps keep for you.",
  );
  await expect(page.getByRole("heading", { name: "Requested permissions" })).toBeVisible();
  const writes = page.getByRole("list", { name: "Can read and change" });
  const reads = page.getByRole("list", { name: "Can only read" });
  // A plain title over the exact path, which stays visible; a plain link has no folder of its own,
  // so every app folder is just an app's. What can change data is listed apart from what only
  // reads it.
  await expect(writes.getByRole("listitem")).toHaveText([
    "Public: An app's data: “example.app”, /pub/example.app/, Read & write",
  ]);
  await expect(reads.getByRole("listitem")).toHaveText([
    "Broad access: All your public data, /pub/, Read only",
  ]);
  const titleColor = (item: Element) =>
    getComputedStyle(item.querySelector("span.flex-1 > span")!).color;
  const scoped = await writes.getByRole("listitem").evaluate(titleColor);
  const broad = await reads.getByRole("listitem").evaluate(titleColor);
  const text = await page.evaluate(() => getComputedStyle(document.body).color);
  // The broad row stands out from the body text and from the scoped row.
  expect(broad).not.toBe(text);
  expect(broad).not.toBe(scoped);
  // A request past the app's own folder names what its primary action gives, and the sentence
  // above it says the same.
  await expect(page.getByRole("button", { name: "Allow reading all public data" })).toBeVisible();
  await expect(
    page.getByText(/^Allowing this lets .+ read all your public data, along with/u),
  ).toBeVisible();
});

test("keyboard focus on Authorize draws a solid outline and keeps the brand border", async ({
  page,
}) => {
  await installLocalIdentityFixture(page);
  await page.goto(authorizationUrl(authorizationRequest(`${RELAY_ORIGIN}/inbox`)));
  await expectSavedIdentityReview(page);
  const authorize = page.getByRole("button", { name: "Authorize", exact: true });

  for (let presses = 0; presses < 20; presses += 1) {
    if (await authorize.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(authorize).toBeFocused();
  // Polled: the outline colour eases in with the button's colour transition.
  await expect
    .poll(() =>
      authorize.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          border: style.borderTopColor,
          textColored: style.outlineColor === getComputedStyle(document.body).color,
          offset: style.outlineOffset,
          style: style.outlineStyle,
          width: style.outlineWidth,
        };
      }),
    )
    .toEqual({
      border: "rgb(200, 255, 0)",
      textColored: true,
      offset: "2px",
      style: "solid",
      width: "2px",
    });
});

test("scrubs a valid request and renders only safe review data", async ({ page, request }) => {
  const url = authorizationUrl(
    authorizationRequest(`${RELAY_ORIGIN}/${RELAY_PATH_CANARY}?region=eu`),
  );
  const leakMonitor = await installAuthorizationLeakMonitor(page);
  await installLocalIdentityFixture(page);
  const baselineResponse = await request.get("/");
  await page.goto("/");
  const response = await page.goto(url);

  expect(response?.ok()).toBe(true);
  const rawInitialBody = await response?.text();
  expect(rawInitialBody).toBeDefined();
  for (const canary of SENSITIVE_CANARIES) expect(rawInitialBody).not.toContain(canary);
  const headers = response?.headers() ?? {};
  expect(headers["cache-control"]).toContain(USE_DEV_SERVER ? "no-cache" : "no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");

  // Both signer pages reach any HTTPS homeserver or relay; the request itself never shapes CSP.
  const policy = headers["content-security-policy"] ?? "";
  const authorizationSources = cspSources(policy, "connect-src");
  expect(authorizationSources).toEqual(
    cspSources(baselineResponse.headers()["content-security-policy"] ?? "", "connect-src"),
  );
  expect(authorizationSources).toContain("https:");
  expect(authorizationSources).not.toContain("https://client.example");
  expect(policy).not.toContain("/private-inbox");
  expect(policy).not.toContain(SENSITIVE_SECRET);

  await expect(page).toHaveURL(/\/authorize$/u);
  // Neither step renders the secret-bearing request, not even as a Ring link or QR.
  await expectSavedIdentityReview(page);
  await expect(page.locator('main a[href^="pubkyauth:"]')).toHaveCount(0);
  const renderedList = await page.locator("main").innerHTML();
  for (const canary of SENSITIVE_CANARIES) expect(renderedList).not.toContain(canary);
  const prompts = confirmLeaving(page);
  await expectSavedIdentityReview(page);
  await expect(page.getByRole("heading", UNVERIFIED_HEADING)).toBeVisible();
  await expect(page.getByText(NAME_IN_REQUEST)).toHaveText(nameInRequest(SOURCE_NAME));
  await expect(page.getByRole("complementary", UNVERIFIED_BAND)).toBeVisible();
  await expect(page.getByText("/pub/example.app/", { exact: true })).toBeVisible();

  await expect(page.locator('main a[href^="pubkyauth:"]')).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toHaveCount(0);
  const renderedReview = await page.locator("main").innerHTML();
  for (const canary of SENSITIVE_CANARIES) expect(renderedReview).not.toContain(canary);
  expect(renderedReview).not.toContain("authorization-success");
  expect(await page.evaluate(() => window.location.search)).toBe("");
  expect(await page.evaluate(() => window.location.hash)).toBe("");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __passportHashAtFirstFrame?: string }).__passportHashAtFirstFrame,
      ),
    )
    .toBe("");
  const authorizationPersistence = await browserPersistenceSnapshot(page);
  expectAuthorizationPersistenceSafe(authorizationPersistence, LOCAL_IDENTITY_STORAGE);

  // Leaving the review asks first, because the app would otherwise wait for an answer.
  await page.goBack();
  await expectEntryWithoutRequest(page, /\/$/u);
  expect(prompts).toEqual(["beforeunload"]);
  // The scrubbed entry no longer holds a request, so it hands over to `/`.
  await page.goForward();
  await expectEntryWithoutRequest(page, /\/$/u);
  const restoredPersistence = await browserPersistenceSnapshot(page);
  expectAuthorizationPersistenceSafe(restoredPersistence, LOCAL_IDENTITY_STORAGE);
  await expectNoSensitiveBrowserLeaks(page, leakMonitor, [
    authorizationPersistence,
    restoredPersistence,
  ]);
});

test("keeps remote images to Google avatars and homeservers and relays to the signer pages", async ({
  request,
}) => {
  const policies = new Map<string, string>();
  for (const [route, status] of [
    ["/authorize", 200],
    ["/", 200],
    ["/privacy-policy", 200],
    ["/terms-of-service", 200],
    ["/missing-page", 404],
  ] as const) {
    const response = await request.get(route);
    expect(response.status()).toBe(status);
    policies.set(route, response.headers()["content-security-policy"] ?? "");
  }
  const connectSources = (route: string) => cspSources(policies.get(route) ?? "", "connect-src");
  const beyondLegalPages = (route: string) => {
    const legal = new Set(connectSources("/privacy-policy"));
    return connectSources(route).filter((source) => !legal.has(source));
  };

  // Pages without the signer reach no homeserver and no relay.
  expect(connectSources("/privacy-policy")).not.toContain("https:");
  expect(connectSources("/privacy-policy")).not.toContain("https://homeserver.example");
  expect(connectSources("/privacy-policy")).not.toContain("https://relay.passport.example");
  expect(connectSources("/terms-of-service")).toEqual(connectSources("/privacy-policy"));
  expect(connectSources("/missing-page")).toEqual(connectSources("/privacy-policy"));
  // Both signer pages reach any homeserver an identity's record names, and any relay.
  expect(beyondLegalPages("/authorize")).toEqual(["https:"]);
  expect(beyondLegalPages("/")).toEqual(["https:"]);
  for (const policy of policies.values()) {
    expect(cspSources(policy, "img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://lh3.googleusercontent.com",
    ]);
  }
});

test("gives every page that renders the app shell its policy, so none can be framed", async ({
  request,
}) => {
  // Paths that only start like the API route or a framework asset still render the 404 page.
  for (const route of ["/apix", "/api", "/api/x", "/favicon.ico", "/favicon.icox", "/_next/x"]) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(404);
    expect(response.headers()["content-type"], route).toContain("text/html");
    const policy = response.headers()["content-security-policy"] ?? "";
    expect(cspSources(policy, "frame-ancestors"), route).toEqual(["'none'"]);
    expect(cspSources(policy, "script-src"), route).toContain("'strict-dynamic'");
    expect(cspSources(policy, "connect-src"), route).not.toContain("https:");
    expect(response.headers()["x-frame-options"], route).toBe("DENY");
  }
});

test("keeps stacked combining marks from drawing over the warning or other rows", async ({
  page,
}) => {
  const marks = "\u0332".repeat(100);
  await installLocalIdentityFixture(page);
  confirmLeaving(page);
  await page.goto(
    authorizationUrl(
      authorizationRequest(`${RELAY_ORIGIN}/inbox`, "cookie", `Acme${marks}`, {
        capabilities: `/pub/evil${marks}.example/:r,/pub/example.app/:rw`,
      }),
    ),
  );
  await expectSavedIdentityReview(page);

  // The request's own label, shown as its unverified claim, is cut and clipped to its line.
  const name = page.getByText(NAME_IN_REQUEST);
  await expect(name.locator("bdi")).toHaveText(`Acme${"\u0332".repeat(3)}`);
  const warning = page.getByText(UNVERIFIED_WARNING);
  await page.evaluate(async () => document.fonts.ready);
  const nameBox = await name.boundingBox();
  const warningBox = await warning.boundingBox();
  expect(nameBox!.y + nameBox!.height).toBeLessThanOrEqual(warningBox!.y);
  expect(await name.evaluate((element) => getComputedStyle(element).overflow)).toBe("hidden");

  const rows = page
    .getByRole("list", { name: /^Can (?:read and change|only read)$/u })
    .getByRole("listitem");
  const evilPath = rows.locator("bdi.font-mono").filter({ hasText: "/pub/evil" });
  await expect(evilPath).toHaveText(`/pub/evil${"\u0332".repeat(3)}.example/`);
  expect(await evilPath.evaluate((element) => getComputedStyle(element).overflow)).toBe("hidden");
  const pathBox = await evilPath.boundingBox();
  const rowBox = await evilPath.locator("xpath=ancestor::li[1]").boundingBox();
  expect(pathBox!.y + pathBox!.height).toBeLessThanOrEqual(rowBox!.y + rowBox!.height + 0.5);
});

test("an entry without a request continues on the home page", async ({ page }) => {
  await installLocalIdentityFixture(page);
  for (const entry of ["/authorize", "/authorize?utm_source=newsletter"]) {
    const homeResponse = waitForHomeDocument(page);
    expect((await page.goto(entry))?.status()).toBe(200);

    // The hand-over loads the home document anew.
    expect((await homeResponse).ok()).toBe(true);
    await expectEntryWithoutRequest(page, /\/$/u);
    await expect(page.getByRole("button", { name: "Manage identity" })).toBeVisible();
  }
});

test("a reload during review asks first, then returns to the home page", async ({ page }) => {
  await installLocalIdentityFixture(page);
  await page.goto(authorizationUrl(authorizationRequest(`${RELAY_ORIGIN}/inbox`)));
  await expectSavedIdentityReview(page);
  await expect(page.getByText(NAME_IN_REQUEST)).toHaveText(nameInRequest(SOURCE_NAME));

  // Dismissing the confirmation keeps the request open; the cancelled reload never settles.
  const dismissed: string[] = [];
  page.once("dialog", (dialog) => {
    dismissed.push(dialog.type());
    void dialog.dismiss();
  });
  await page.reload({ timeout: 2_000 }).catch(() => undefined);
  expect(dismissed).toEqual(["beforeunload"]);
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeVisible();

  // The request is never stored, so a confirmed reload cannot bring it back.
  const prompts = confirmLeaving(page);
  const homeResponse = waitForHomeDocument(page);
  await page.reload();
  expect(prompts).toEqual(["beforeunload"]);

  expect((await homeResponse).ok()).toBe(true);
  await expectEntryWithoutRequest(page, /\/$/u);
  await expect(page.getByRole("button", { name: "Manage identity" })).toBeVisible();
});

test("forwards a query to the entry for rejection without sending its contents again", async ({
  page,
}) => {
  const request = authorizationRequest(`${RELAY_ORIGIN}/${RELAY_PATH_CANARY}`);
  for (const home of [
    `/?d=${encodeURIComponent(request)}`,
    `/?utm_source=${RELAY_PATH_CANARY}#d=${encodeURIComponent(request)}`,
  ]) {
    const documents: string[] = [];
    const recordDocument = (outgoing: { resourceType(): string; url(): string }) => {
      if (outgoing.resourceType() === "document") documents.push(outgoing.url());
    };
    page.on("request", recordDocument);
    await page.goto(home);

    await expect(page.getByRole("heading", { name: "Invalid sign-in link." })).toBeVisible();
    await expectEntryWithoutRequest(page, /\/authorize$/u);
    page.off("request", recordDocument);
    // The first document request is the test's own; Passport's forward carries only `?d=`.
    expect(documents.slice(1).map((url) => new URL(url).pathname + new URL(url).search)).toEqual([
      "/authorize?d=",
    ]);
    for (const url of documents.slice(1)) {
      for (const canary of SENSITIVE_CANARIES) expect(url).not.toContain(canary);
    }
  }
});

test("forwards a request sent to the home page before Passport code runs", async ({ page }) => {
  const leakMonitor = await installAuthorizationLeakMonitor(page);
  await installLocalIdentityFixture(page);
  await page.goto("/privacy-policy");
  const homeResponse = waitForHomeDocument(page);

  await page.goto(
    `/#d=${encodeURIComponent(authorizationRequest(`${RELAY_ORIGIN}/${RELAY_PATH_CANARY}`))}`,
  );

  expect((await homeResponse).ok()).toBe(true);
  await expectEntryWithoutRequest(page, /\/authorize$/u);
  await expectSavedIdentityReview(page);
  await expect(page.getByText(NAME_IN_REQUEST)).toHaveText(nameInRequest(SOURCE_NAME));
  const persistence = await browserPersistenceSnapshot(page);
  expectAuthorizationPersistenceSafe(persistence, LOCAL_IDENTITY_STORAGE);

  // The forward replaced the `/#d=…` entry: Back returns to the page before, and Forward reaches
  // the scrubbed entry, which holds no request any more and hands over to `/`.
  await page.goBack();
  await expectEntryWithoutRequest(page, /\/privacy-policy$/u);
  await page.goForward();
  await expectEntryWithoutRequest(page, /\/$/u);
  await expectNoSensitiveBrowserLeaks(page, leakMonitor, [persistence]);
});

test("forwards a request navigated into an open home page", async ({ page }) => {
  const leakMonitor = await installAuthorizationLeakMonitor(page);
  await installLocalIdentityFixture(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Manage identity" })).toBeVisible();

  // A pasted link or a reused named popup is a same-document fragment navigation.
  await page.evaluate(
    (request) => {
      window.location.hash = `d=${encodeURIComponent(request)}`;
    },
    authorizationRequest(`${RELAY_ORIGIN}/${RELAY_PATH_CANARY}`),
  );

  await expectEntryWithoutRequest(page, /\/authorize$/u);
  await expectSavedIdentityReview(page);
  await expect(page.getByText(NAME_IN_REQUEST)).toHaveText(nameInRequest(SOURCE_NAME));
  const persistence = await browserPersistenceSnapshot(page);
  expectAuthorizationPersistenceSafe(persistence, LOCAL_IDENTITY_STORAGE);

  // The fragment navigation's entry was replaced by the forward; Back reaches the clean home page.
  await page.goBack();
  await expectEntryWithoutRequest(page, /\/$/u);
  await expect(page.getByRole("button", { name: "Manage identity" })).toBeVisible();
  await expectNoSensitiveBrowserLeaks(page, leakMonitor, [persistence]);
});

test("captures a new request navigated into an open authorization page", async ({ page }) => {
  const leakMonitor = await installAuthorizationLeakMonitor(page);
  await installLocalIdentityFixture(page);
  await page.goto(
    authorizationUrl(authorizationRequest(`${RELAY_ORIGIN}/inbox`, "cookie", "First App")),
  );
  await expect(page.getByText(NAME_IN_REQUEST)).toHaveText(nameInRequest("First App"));
  // The identity list loads the SDK for profile reads; Firefox reports a script cut short by the
  // reload below to the console with the new request in the page URL, so the page settles first.
  await page.waitForLoadState("networkidle");

  // A reused named popup navigates the same document to the next request.
  await page.evaluate(
    (request) => {
      window.location.hash = `d=${encodeURIComponent(request)}`;
    },
    authorizationRequest(`${RELAY_ORIGIN}/${RELAY_PATH_CANARY}`),
  );

  await expect(page.getByText(NAME_IN_REQUEST)).toHaveText(nameInRequest(SOURCE_NAME));
  await expectEntryWithoutRequest(page, /\/authorize$/u);
  const persistence = await browserPersistenceSnapshot(page);
  expectAuthorizationPersistenceSafe(persistence, LOCAL_IDENTITY_STORAGE);

  // Both requests' entries were scrubbed. Back may stay in the reloaded document or load the first
  // entry anew, which then hands over to `/`; either way no entry holds a request.
  await page.goBack();
  await expectEntryWithoutRequest(page, /\/(?:authorize)?$/u);
  await expectNoSensitiveBrowserLeaks(page, leakMonitor, [persistence]);
});

test("shows the request to Ring only in its link and QR code", async ({ page, isMobile }) => {
  const request = authorizationRequest(`${RELAY_ORIGIN}/${RELAY_PATH_CANARY}`, "grant");
  // A phone follows the request's own deep link to Ring: the designed hand-off, not a leak.
  const leakMonitor = await installAuthorizationLeakMonitor(page, { handoff: request });
  await installLocalIdentityFixture(page);
  await page.goto(authorizationUrl(request));
  // One saved identity opens on its review, whose "or" offers Pubky Ring.
  await page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
  const links = page.locator('main a[href^="pubkyauth:"]');
  const qrCode = page.getByRole("img", { name: "Pubky authorization QR code" });
  // A computer gets the QR code and no link, which it cannot open; a phone gets one button that
  // follows the link, and no code, which it cannot scan from its own screen.
  if (isMobile) {
    await expect(links).toHaveAttribute("href", request);
    await expect(links).toHaveCount(1);
    await expect(qrCode).toHaveCount(0);
  } else {
    await expect(qrCode).toBeVisible();
    await expect(links).toHaveCount(0);
  }
  await expect.poll(() => leakMonitor.handoffs).toBe(isMobile ? 1 : 0);
  // Apart from that one href, the markup (text, aria and data attributes, the QR's SVG paths)
  // carries none of the request.
  const markupWithoutLink = await page.locator("main").evaluate((main) => {
    const copy = main.cloneNode(true) as HTMLElement;
    copy.querySelector('a[href^="pubkyauth:"]')?.removeAttribute("href");
    return copy.innerHTML;
  });
  for (const canary of SENSITIVE_CANARIES) expect(markupWithoutLink).not.toContain(canary);
  expect(await page.evaluate(() => window.location.hash)).toBe("");
  const persistence = await browserPersistenceSnapshot(page);
  expectAuthorizationPersistenceSafe(persistence, LOCAL_IDENTITY_STORAGE);
  await expectNoSensitiveBrowserLeaks(page, leakMonitor, [persistence]);
});

test("rejects an unsafe relay without adding it to CSP", async ({ page }) => {
  const unsafeRelayOrigin = "http://unsafe-relay.client.example";
  const url = authorizationUrl(authorizationRequest(`${unsafeRelayOrigin}/private-inbox`));
  const leakMonitor = await installAuthorizationLeakMonitor(page);
  const response = await page.goto(url);

  expect(response?.ok()).toBe(true);
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(cspSources(policy, "connect-src")).not.toContain(unsafeRelayOrigin);

  await expect(page).toHaveURL(/\/authorize$/u);
  await expect(page.getByRole("heading", { name: "Invalid sign-in link." })).toBeVisible();
  expect(await page.evaluate(() => window.location.search)).toBe("");
  expect(await page.evaluate(() => window.location.hash)).toBe("");
  const renderedState = await page.locator("main").innerHTML();
  for (const canary of SENSITIVE_CANARIES) expect(renderedState).not.toContain(canary);
  const persistence = await browserPersistenceSnapshot(page);
  expectAuthorizationPersistenceSafe(persistence);
  await expectNoSensitiveBrowserLeaks(page, leakMonitor, [persistence]);

  // Leaving a finished request loads `/` anew; in a tab of its own the way out says so.
  const homeResponse = waitForHomeDocument(page);
  await page.getByRole("button", { name: "Go to Passport" }).click();
  expect((await homeResponse).ok()).toBe(true);
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
});

test("sends an invalid link in a tab back to the app that sent it, not into onboarding", async ({
  page,
}) => {
  await page.route("https://client.example/**", (route) =>
    route.fulfill({ body: "<!doctype html><title>Client</title>", contentType: "text/html" }),
  );
  await page.goto("https://client.example/start");
  await page.goto(authorizationUrl("pubkyauth://signin?caps=nope"));

  await expect(page.getByRole("heading", { name: "Invalid sign-in link." })).toBeVisible();
  // Passport's start page stays a side action.
  await expect(page.getByRole("button", { name: "Go to Passport" })).toBeVisible();
  await page.getByRole("button", { name: "Back to the app" }).click();
  await expect(page).toHaveURL("https://client.example/start");
});

test("reviews and scrubs a v0.10 grant authorization request", async ({ page }) => {
  const url = authorizationUrl(
    authorizationRequest(`${RELAY_ORIGIN}/${RELAY_PATH_CANARY}`, "grant"),
  );
  const leakMonitor = await installAuthorizationLeakMonitor(page);
  await installLocalIdentityFixture(page);

  const response = await page.goto(url);

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/authorize$/u);
  await expectSavedIdentityReview(page);
  await expect(page.getByText(NAME_IN_REQUEST)).toHaveText(nameInRequest(SOURCE_NAME));
  await expect(page.locator('main a[href^="pubkyauth:"]')).toHaveCount(0);
  expect(await page.locator("main").innerHTML()).not.toContain(GRANT_CLIENT_PUBLIC_KEY);
  expect(await page.evaluate(() => window.location.search)).toBe("");
  expect(await page.evaluate(() => window.location.hash)).toBe("");
  const persistence = await browserPersistenceSnapshot(page);
  expectAuthorizationPersistenceSafe(persistence, LOCAL_IDENTITY_STORAGE);
  await expectNoSensitiveBrowserLeaks(page, leakMonitor, [persistence]);
});

test("manual entry reloads into fragment-backed capability review", async ({ page }) => {
  await installLocalIdentityFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Authorize an app" }).click();

  await page
    .getByRole("textbox", { name: "Authorization link" })
    .fill(authorizationRequest(`${RELAY_ORIGIN}/inbox`));
  await page.getByRole("button", { name: "Continue" }).click();

  await expectSavedIdentityReview(page);
  await expect(page.getByText(NAME_IN_REQUEST)).toHaveText(nameInRequest(SOURCE_NAME));
  await expect(page).toHaveURL(/\/authorize$/u);
  expect(await page.evaluate(() => window.location.hash)).toBe("");
});

test("Authorize on an identity's overview opens the request on that identity's review, once", async ({
  page,
}) => {
  await installLocalIdentityFixture(page);
  // A second saved identity: an app's request would first ask which one to use.
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [
      `pubky-passport/local-identities/v1/identity/${GRANT_CLIENT_PUBLIC_KEY}`,
      JSON.stringify({
        v: 1,
        publicKeyZ32: GRANT_CLIENT_PUBLIC_KEY,
        secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      }),
    ],
  );
  confirmLeaving(page);
  const request = authorizationRequest(`${RELAY_ORIGIN}/inbox`);
  const list = page.getByRole("list", { name: "Choose the identity to sign in with." });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Selected identity" })).toContainText(
    LOCAL_IDENTITY_PUBLIC_KEY,
  );
  await page.getByRole("button", { name: "Authorize an app" }).click();
  await page.getByRole("textbox", { name: "Authorization link" }).fill(request);
  await page.getByRole("button", { name: "Continue" }).click();

  // The identity was chosen by pressing its Authorize: no list, straight to its review.
  await expectSavedIdentityReview(page);
  await expect(page.getByText(NAME_IN_REQUEST)).toHaveText(nameInRequest(SOURCE_NAME));
  await expect(page).toHaveURL(/\/authorize$/u);
  // The note that carried the choice across the reload holds a public key only and is gone.
  expect(
    await page.evaluate(() => sessionStorage.getItem("pubky-passport/authorize-from-identity")),
  ).toBeNull();
  // Switch still leads to the list.
  await page.getByRole("button", { name: "Switch identity" }).click();
  await expect(list.getByRole("button")).toHaveCount(2);

  // A request an app opens afterwards asks again, as every request with several identities does.
  await page.goto("about:blank");
  await page.goto(authorizationUrl(request));
  await expect(list.getByRole("button")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toHaveCount(0);
});

test("falls back to the cancel callback when the opener does not acknowledge", async ({ page }) => {
  await page.context().route("https://client.example/**", (route) =>
    route.fulfill({
      body: "<!doctype html><title>Returned</title><h1>Returned to app</h1>",
      contentType: "text/html",
    }),
  );
  await page.goto("/");
  await page.evaluate((entries) => {
    for (const [key, value] of entries) window.localStorage.setItem(key, value);
  }, Object.entries(LOCAL_IDENTITY_STORAGE));
  const popupPromise = page.waitForEvent("popup");
  await page.evaluate(
    (url) => {
      window.open(url, "pubky-passport", "popup,width=480,height=760");
    },
    authorizationUrl(authorizationRequest(`${RELAY_ORIGIN}/inbox`)),
  );
  const popup = await popupPromise;

  await expectSavedIdentityReview(popup);
  await popup.getByRole("button", { name: "Cancel" }).click();

  await expect(popup).toHaveURL(/https:\/\/client\.example\/authorization-cancel/u);
  await expect(popup.getByRole("heading", { name: "Returned to app" })).toBeVisible();
});

test("notifies the callback-origin opener and closes after acknowledgement", async ({ page }) => {
  await page.goto("/");
  const passportOrigin = new URL(page.url()).origin;
  await page.evaluate((entries) => {
    for (const [key, value] of entries) window.localStorage.setItem(key, value);
  }, Object.entries(LOCAL_IDENTITY_STORAGE));
  await page.context().route("https://client.example/**", (route) =>
    route.fulfill({
      body: "<!doctype html><title>Client integration</title><h1>Client integration</h1>",
      contentType: "text/html",
    }),
  );
  await page.goto("https://client.example/integration");
  await page.evaluate((trustedPassportOrigin) => {
    window.addEventListener("message", (event) => {
      const message = event.data as Record<string, unknown>;
      if (
        event.origin !== trustedPassportOrigin ||
        message.type !== "pubky-passport.authorization-outcome" ||
        message.version !== 1 ||
        typeof message.messageId !== "string"
      )
        return;
      (event.source as Window | null)?.postMessage(
        {
          type: "pubky-passport.authorization-outcome-ack",
          version: 1,
          messageId: message.messageId,
        },
        trustedPassportOrigin,
      );
      Object.defineProperty(window, "__passportOutcome", { value: message.outcome });
    });
  }, passportOrigin);
  const popupPromise = page.waitForEvent("popup");
  const popupUrl = new URL(
    authorizationUrl(authorizationRequest(`${RELAY_ORIGIN}/inbox`)),
    passportOrigin,
  ).href;
  await page.evaluate((url) => {
    window.open(url, "pubky-passport-ack", "popup,width=480,height=760");
  }, popupUrl);
  const popup = await popupPromise;

  await expectSavedIdentityReview(popup);
  await popup.getByRole("button", { name: "Cancel" }).click();

  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(
    await page.evaluate(
      () => (window as Window & { __passportOutcome?: string }).__passportOutcome,
    ),
  ).toBe("cancel");
});

test("uses the cancel callback for direct navigation without an opener", async ({ page }) => {
  await page.route("https://client.example/**", (route) =>
    route.fulfill({
      body: "<!doctype html><title>Returned</title><h1>Returned to app</h1>",
      contentType: "text/html",
    }),
  );
  await installLocalIdentityFixture(page);
  await page.goto(authorizationUrl(authorizationRequest(`${RELAY_ORIGIN}/inbox`)));

  await expectSavedIdentityReview(page);
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page).toHaveURL(/https:\/\/client\.example\/authorization-cancel/u);
  await expect(page.getByRole("heading", { name: "Returned to app" })).toBeVisible();
});

function authorizationRequest(
  relay: string,
  authenticationMethod: "cookie" | "grant" = "cookie",
  source: string | null = SOURCE_NAME,
  {
    callbackOrigin = "https://client.example",
    capabilities = "/pub/example.app/:rw",
  }: { callbackOrigin?: string | null; capabilities?: string } = {},
): string {
  const request = new URL(
    `pubkyauth://${authenticationMethod === "grant" ? "signin_grant" : "signin"}`,
  );
  request.searchParams.set("caps", capabilities);
  request.searchParams.set("relay", relay);
  request.searchParams.set("secret", SENSITIVE_SECRET);
  if (authenticationMethod === "grant") {
    request.searchParams.set("cid", GRANT_CLIENT_ID);
    request.searchParams.set("cpk", GRANT_CLIENT_PUBLIC_KEY);
  }
  if (callbackOrigin !== null) {
    for (const outcome of ["success", "error", "cancel"]) {
      request.searchParams.set(
        `x-${outcome}`,
        `${callbackOrigin}/authorization-${outcome}?${CALLBACK_QUERY_CANARY}`,
      );
    }
  }
  return source === null ? request.href : `${request.href}&x-source=${encodeURIComponent(source)}`;
}

function authorizationUrl(request: string): string {
  return `/authorize#d=${encodeURIComponent(request)}`;
}

/** Waits for the document response of `/`. */
function waitForHomeDocument(page: Page) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/" && response.request().resourceType() === "document",
  );
}

/** Waits for the current history entry to settle on `path`, then checks it holds no request. */
async function expectEntryWithoutRequest(page: Page, path: RegExp): Promise<void> {
  await expect(page).toHaveURL(path);
  expect(await evaluateSettled(page, () => window.location.search + window.location.hash)).toBe("");
  for (const canary of SENSITIVE_CANARIES) expect(page.url()).not.toContain(canary);
}

/** One identity is saved, so a request opens straight on its review; Switch leads to the list. */
async function expectSavedIdentityReview(page: Page): Promise<void> {
  // A request for broad access names what its primary action gives.
  await expect(
    page.getByRole("button", { name: /^(?:Authorize|Allow (?:reading|changing) all .+)$/u }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Choose the identity to sign in with." }),
  ).toHaveCount(0);
}

/**
 * Accepts the browser's leave confirmation, which a pending request raises once the person has
 * interacted with the page, for tests that navigate away from a review on purpose.
 */
function confirmLeaving(page: Page): string[] {
  const prompts: string[] = [];
  page.on("dialog", (dialog) => {
    prompts.push(dialog.type());
    void dialog.accept();
  });
  return prompts;
}

function expectWithinOnePixel(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
}

function cspSources(policy: string, directiveName: string): string[] {
  const directive = policy
    .split(";")
    .find((candidate) => candidate.trimStart().startsWith(`${directiveName} `));
  return directive?.trim().split(/\s+/u).slice(1) ?? [];
}

/**
 * Evaluates once the page's navigation has settled. History moves and the entry's hand-over to `/`
 * are full navigations, and WebKit may still be replacing the document when the URL already shows
 * the destination, so an evaluation then fails with a destroyed execution context. It waits for
 * the load, and retries only that failure, after the next load.
 */
async function evaluateSettled<Value>(page: Page, evaluate: () => Value | Promise<Value>) {
  for (let attempt = 1; ; attempt++) {
    await page.waitForLoadState("load");
    try {
      return await page.evaluate(evaluate);
    } catch (e) {
      const replaced = e instanceof Error && /Execution context was destroyed/u.test(e.message);
      if (!replaced || attempt >= 3) throw e;
    }
  }
}

async function browserPersistenceSnapshot(page: Page) {
  return evaluateSettled(page, async () => {
    const storageEntries = (storage: Storage) =>
      Array.from({ length: storage.length }, (_, index) => storage.key(index))
        .filter((key): key is string => key !== null)
        .map((key) => [key, storage.getItem(key)]);

    return {
      localStorage: Object.fromEntries(storageEntries(window.localStorage)),
      sessionStorage: Object.fromEntries(storageEntries(window.sessionStorage)),
      cookies: document.cookie,
      historyState: window.history.state,
      writes:
        (window as Window & { __passportPersistenceWrites?: string[] })
          .__passportPersistenceWrites ?? [],
      indexedDatabases:
        typeof indexedDB.databases === "function"
          ? (await indexedDB.databases())
              .filter(({ name }) => name !== "__next_debug_channel")
              .map(({ name, version }) => ({ name, version }))
          : [],
      caches: "caches" in window ? await caches.keys() : [],
    };
  });
}

type BrowserPersistenceSnapshot = Awaited<ReturnType<typeof browserPersistenceSnapshot>>;

type AuthorizationLeakMonitor = {
  browserLeaks: string[];
  /** Navigations to the request's own deep link, the designed hand-off to Pubky Ring. */
  handoffs: number;
};

async function installAuthorizationLeakMonitor(
  page: Page,
  { handoff }: { handoff?: string } = {},
): Promise<AuthorizationLeakMonitor> {
  const browserLeaks: string[] = [];
  const monitor = { browserLeaks, handoffs: 0 };
  await installPersistenceObserver(page);
  await page.addInitScript(() => {
    requestAnimationFrame(() => {
      Object.defineProperty(window, "__passportHashAtFirstFrame", {
        configurable: true,
        value: window.location.hash,
      });
    });
  });
  page.on("console", (message) => browserLeaks.push(message.text()));
  page.on("request", (outgoing) => {
    if (handoff !== undefined && outgoing.url() === handoff && !outgoing.postData()) {
      monitor.handoffs += 1;
      return;
    }
    browserLeaks.push(
      `${outgoing.url()}\n${outgoing.postData() ?? ""}\n${outgoing.headers().referer ?? ""}`,
    );
  });
  return monitor;
}

async function expectNoSensitiveBrowserLeaks(
  page: Page,
  monitor: AuthorizationLeakMonitor,
  persistence: BrowserPersistenceSnapshot[],
): Promise<void> {
  const observedBrowserData = JSON.stringify({
    browserLeaks: monitor.browserLeaks,
    persistence,
    cookies: await page.context().cookies(),
  });
  for (const canary of SENSITIVE_CANARIES) expect(observedBrowserData).not.toContain(canary);
}

function expectAuthorizationPersistenceSafe(
  snapshot: BrowserPersistenceSnapshot,
  expectedLocalStorage: Record<string, string> = {},
): void {
  expect(snapshot.localStorage).toEqual(expectedLocalStorage);
  expect(snapshot.sessionStorage).toEqual({});
  expect(snapshot.cookies).toBe("");
  for (const canary of SENSITIVE_CANARIES) {
    expect(JSON.stringify(snapshot.historyState)).not.toContain(canary);
  }
  const expectedIdentityWrites = new Set(
    Object.entries(expectedLocalStorage).map(([key, value]) => `storage:${key}:${value}`),
  );
  expect(snapshot.writes.filter((write) => !expectedIdentityWrites.has(write))).toEqual([]);
  expect(snapshot.indexedDatabases).toEqual([]);
  expect(snapshot.caches).toEqual([]);
}

async function installLocalIdentityFixture(page: Page): Promise<void> {
  await page.addInitScript((entries) => {
    for (const [key, value] of entries) window.localStorage.setItem(key, value);
  }, Object.entries(LOCAL_IDENTITY_STORAGE));
}

async function installPersistenceObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const writes: string[] = [];
    Object.defineProperty(window, "__passportPersistenceWrites", { value: writes });
    const serialize = (value: unknown): string => {
      try {
        return JSON.stringify(value) ?? String(value);
      } catch {
        return String(value);
      }
    };

    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function observedSetItem(key: string, value: string): void {
      writes.push(`storage:${key}:${value}`);
      setItem.call(this, key, value);
    };

    const databaseFactory = indexedDB as IDBFactory & { open: IDBFactory["open"] };
    const openDatabase = (name: string, version?: number) =>
      version === undefined
        ? IDBFactory.prototype.open.call(databaseFactory, name)
        : IDBFactory.prototype.open.call(databaseFactory, name, version);
    databaseFactory.open = ((name: string, version?: number) => {
      if (name !== "__next_debug_channel") {
        writes.push(`indexedDB:${name}:${version ?? "default"}`);
      }
      return version === undefined ? openDatabase(name) : openDatabase(name, version);
    }) as IDBFactory["open"];

    const addRecord = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function observedAdd(
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.transaction.db.name !== "__next_debug_channel") {
        writes.push(`indexedDB-add:${serialize(value)}:${serialize(key)}`);
      }
      return key === undefined ? addRecord.call(this, value) : addRecord.call(this, value, key);
    } as IDBObjectStore["add"];

    const putRecord = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function observedPut(
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.transaction.db.name !== "__next_debug_channel") {
        writes.push(`indexedDB-put:${serialize(value)}:${serialize(key)}`);
      }
      return key === undefined ? putRecord.call(this, value) : putRecord.call(this, value, key);
    } as IDBObjectStore["put"];

    if ("caches" in window) {
      const cacheStorage = caches as CacheStorage & { open: CacheStorage["open"] };
      const openCache = (name: string) => CacheStorage.prototype.open.call(cacheStorage, name);
      cacheStorage.open = (async (name: string) => {
        writes.push(`cache:${name}`);
        return openCache(name);
      }) as CacheStorage["open"];

      const requestLabel = (request: RequestInfo | URL): string =>
        request instanceof Request ? request.url : String(request);
      const addToCache = Cache.prototype.add;
      Cache.prototype.add = function observedCacheAdd(this: Cache, request: RequestInfo | URL) {
        writes.push(`cache-add:${requestLabel(request)}`);
        return addToCache.call(this, request);
      } as Cache["add"];

      const addAllToCache = Cache.prototype.addAll;
      Cache.prototype.addAll = function observedCacheAddAll(
        this: Cache,
        requests: Iterable<RequestInfo>,
      ) {
        const requestList = Array.from(requests);
        writes.push(`cache-add-all:${requestList.map(requestLabel).join(",")}`);
        return addAllToCache.call(this, requestList);
      } as Cache["addAll"];

      const putInCache = Cache.prototype.put;
      Cache.prototype.put = function observedCachePut(
        this: Cache,
        request: RequestInfo | URL,
        response: Response,
      ) {
        writes.push(`cache-put:${requestLabel(request)}`);
        void response
          .clone()
          .text()
          .then((body) => writes.push(`cache-response:${body}`));
        return putInCache.call(this, request, response);
      } as Cache["put"];
    }
  });
}
