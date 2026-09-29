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
  await expect(page.getByRole("button", { name: "Import backup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
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

    const band = page.getByLabel("Signing in to client.example");
    const logo = page.getByRole("img", { name: "Pubky", exact: true });
    const main = page.locator("main");
    await expect(band).toBeVisible();
    await expect(band.locator("svg")).toHaveAttribute("viewBox", "0 0 24 24");
    await expect(band.locator("svg path")).toHaveAttribute(
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
    expectWithinOnePixel(bandBox?.height ?? -1, 34);
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

test("falls back to the callback domain when x-source is absent", async ({ page }) => {
  await installLocalIdentityFixture(page);
  await page.goto(authorizationUrl(authorizationRequest(`${RELAY_ORIGIN}/inbox`, "cookie", null)));
  await chooseSavedIdentity(page);

  await expect(page.getByRole("heading", { name: "Sign in to client.example" })).toBeVisible();
  await expect(page.getByLabel("Signing in to client.example")).toBeVisible();
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
    await chooseSavedIdentity(page);

    await expect(page.getByRole("heading", { name: `Sign in to ${source}` })).toBeVisible();
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
    await chooseSavedIdentity(page);
    await page.evaluate(async () => document.fonts.ready);

    await expect(page.getByRole("heading", { name: "Sign in to Google" })).toBeVisible();
    await expect(page.getByText(`Website: ${host}`, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Authorize", exact: true }),
    ).toHaveAccessibleDescription(`Website: ${host}`);
    await expect(page.getByText(`allow Google (${host}) to read and update`)).toBeVisible();

    // The band truncates from the start: the registrable domain at the end stays inside the clip.
    const band = page.getByLabel(`Signing in to ${host}`);
    const tail = await band.getByTitle(host).evaluate((clip, suffix) => {
      const text = clip.querySelector("bdi")!.firstChild!;
      const range = document.createRange();
      range.setStart(text, text.textContent!.length - suffix.length);
      range.setEnd(text, text.textContent!.length);
      const visible = clip.getBoundingClientRect();
      const end = range.getBoundingClientRect();
      return { left: end.left - visible.left, right: visible.right - end.right };
    }, "attacker.example");
    expect(tail.left).toBeGreaterThanOrEqual(-1);
    expect(tail.right).toBeGreaterThanOrEqual(-1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  }
});

test("says so when a request names no website instead of trusting its label alone", async ({
  page,
}) => {
  await installLocalIdentityFixture(page);
  await page.goto(
    authorizationUrl(
      authorizationRequest(`${RELAY_ORIGIN}/inbox`, "cookie", "Google", { callbackOrigin: null }),
    ),
  );
  await chooseSavedIdentity(page);

  const notice =
    "This request doesn't name a website. Only continue if you just started signing in on another device.";
  await expect(page.getByRole("heading", { name: "Sign in to Google" })).toBeVisible();
  await expect(page.getByText(notice, { exact: true })).toBeVisible();
  await expect(page.getByText(/^Website:/u)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Authorize", exact: true }),
  ).toHaveAccessibleDescription(notice);
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
  await chooseSavedIdentity(page);

  await expect(page.locator("main").getByRole("alert")).toHaveText(
    "This app asks for all your public data, including the folders other apps keep for you.",
  );
  const permissions = page.getByRole("list", { name: "Requested permissions" });
  // A plain title over the exact path, which stays visible; a folder that is not the requesting
  // website's own is another app's.
  await expect(permissions.getByRole("listitem")).toHaveText([
    "Another app's data: “example.app”, /pub/example.app/, Read & write",
    "Broad access: All your public data, /pub/, Read only",
  ]);
  const [scoped, broad, text] = await permissions
    .getByRole("listitem")
    .evaluateAll((items) => [
      ...items.map((item) => getComputedStyle(item.querySelector("span.flex-1 > span")!).color),
      getComputedStyle(document.body).color,
    ]);
  expect(scoped).toBe(text);
  expect(broad).not.toBe(text);
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
  await chooseSavedIdentity(page);
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
  await expectIdentityList(page);
  await expect(page.locator('main a[href^="pubkyauth:"]')).toHaveCount(0);
  const renderedList = await page.locator("main").innerHTML();
  for (const canary of SENSITIVE_CANARIES) expect(renderedList).not.toContain(canary);
  const prompts = confirmLeaving(page);
  await chooseSavedIdentity(page);
  await expect(page.getByRole("heading", { name: `Sign in to ${SOURCE_NAME}` })).toBeVisible();
  await expect(page.getByLabel("Signing in to client.example")).toBeVisible();
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
  await chooseSavedIdentity(page);
  await expect(page.getByRole("heading", { name: `Sign in to ${SOURCE_NAME}` })).toBeVisible();

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
  await expectIdentityList(page);
  await expect(page.getByRole("heading", { name: `Sign in to ${SOURCE_NAME}` })).toBeVisible();
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
  await expectIdentityList(page);
  await expect(page.getByRole("heading", { name: `Sign in to ${SOURCE_NAME}` })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Sign in to First App" })).toBeVisible();
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

  await expect(page.getByRole("heading", { name: `Sign in to ${SOURCE_NAME}` })).toBeVisible();
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
  await page.getByRole("button", { name: "Open in Pubky Ring", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
  // A computer gets the QR code at once; a phone falls back to it when Ring does not open.
  await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
  expect(leakMonitor.handoffs).toBe(isMobile ? 1 : 0);

  const links = page.locator('main a[href^="pubkyauth:"]');
  // Only a phone gets the link; a computer cannot open it.
  await expect(links).toHaveCount(isMobile ? 1 : 0);
  if (isMobile) await expect(links).toHaveAttribute("href", request);
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
  await chooseSavedIdentity(page);
  await expect(page.getByRole("heading", { name: `Sign in to ${SOURCE_NAME}` })).toBeVisible();
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

  await chooseSavedIdentity(page);
  await expect(page.getByRole("heading", { name: `Sign in to ${SOURCE_NAME}` })).toBeVisible();
  await expect(page).toHaveURL(/\/authorize$/u);
  expect(await page.evaluate(() => window.location.hash)).toBe("");
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

  await chooseSavedIdentity(popup);
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

  await chooseSavedIdentity(popup);
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

  await chooseSavedIdentity(page);
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
  expect(await page.evaluate(() => window.location.search + window.location.hash)).toBe("");
  for (const canary of SENSITIVE_CANARIES) expect(page.url()).not.toContain(canary);
}

/** The request opens on its identity list; choosing the saved identity opens its review. */
async function chooseSavedIdentity(page: Page): Promise<void> {
  await expectIdentityList(page);
  await identityList(page).getByRole("button").first().click();
  // A request for broad access names what its primary action gives.
  await expect(
    page.getByRole("button", { name: /^(?:Authorize|Allow (?:reading|changing) all .+)$/u }),
  ).toBeVisible();
}

function identityList(page: Page) {
  return page.getByRole("list", { name: "Choose the identity to sign in with." });
}

async function expectIdentityList(page: Page): Promise<void> {
  await expect(identityList(page)).toBeVisible();
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

async function browserPersistenceSnapshot(page: Page) {
  return page.evaluate(async () => {
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
