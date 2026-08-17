import { expect, test, type Page } from "@playwright/test";

const SENSITIVE_SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
const RELAY_ORIGIN = "https://relay.client.example";
const RELAY_PATH_CANARY = "private-inbox";
const CALLBACK_QUERY_CANARY = "session=sensitive";
const GRANT_CLIENT_ID = "grant-client.example";
const GRANT_CLIENT_PUBLIC_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const SENSITIVE_CANARIES = [
  SENSITIVE_SECRET,
  RELAY_PATH_CANARY,
  CALLBACK_QUERY_CANARY,
  GRANT_CLIENT_ID,
  GRANT_CLIENT_PUBLIC_KEY,
];
const LOCAL_IDENTITY_STORAGE_KEY = "pubky-passport/local-identities/v1";
const LOCAL_IDENTITY_STORAGE_VALUE = JSON.stringify({
  v: 1,
  activeIdentityId: "e2e-public-key",
  identities: [{
    id: "e2e-public-key",
    publicIdentity: { publicKeyDisplay: "pubkye2e-public-key", publicKeyZ32: "e2e-public-key" },
    secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
  }],
});

test("shows manual authorization entry when no request was supplied", async ({ page }) => {
  await page.goto("/authorize");

  await expect(page.getByRole("heading", { name: "Authorize a service." })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Authorization link" })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Authorization link" })).toHaveAttribute("placeholder", "pubkyauth://");
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
});

test("scrubs a valid request and renders only safe review data", async ({ page, request }) => {
  const url = authorizationUrl(authorizationRequest(`${RELAY_ORIGIN}/${RELAY_PATH_CANARY}?region=eu`));
  await installLocalIdentityFixture(page);
  const leakMonitor = await installAuthorizationLeakMonitor(page);
  const baselineResponse = await request.get("/");
  await page.goto("/");
  const response = await page.goto(url);

  expect(response?.ok()).toBe(true);
  const rawInitialBody = await response?.text();
  expect(rawInitialBody).toBeDefined();
  for (const canary of SENSITIVE_CANARIES) expect(rawInitialBody).not.toContain(canary);
  const headers = response?.headers() ?? {};
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");

  const policy = headers["content-security-policy"] ?? "";
  const baselineSources = new Set(cspSources(baselineResponse.headers()["content-security-policy"] ?? "", "connect-src"));
  const authorizationSources = cspSources(policy, "connect-src");
  expect(baselineSources).toContain("https://homeserver.example");
  expect(authorizationSources.filter((source) => !baselineSources.has(source))).toEqual(["https:"]);
  expect(authorizationSources).not.toContain("https://client.example");
  expect(policy).not.toContain("/private-inbox");
  expect(policy).not.toContain(SENSITIVE_SECRET);

  await expect(page).toHaveURL(/\/authorize$/u);
  await expect(page.getByRole("heading", { name: "Sign in to client.example" })).toBeVisible();
  await expect(page.getByText("/pub/example.app/", { exact: true })).toBeVisible();

  const renderedReview = await page.locator("main").innerHTML();
  for (const canary of SENSITIVE_CANARIES) expect(renderedReview).not.toContain(canary);
  expect(renderedReview).not.toContain("authorization-success");
  expect(await page.evaluate(() => window.location.search)).toBe("");
  expect(await page.evaluate(() => window.location.hash)).toBe("");
  expect(await page.evaluate(() => (window as Window & { __passportHashAtFirstFrame?: string }).__passportHashAtFirstFrame)).toBe("");
  const authorizationPersistence = await browserPersistenceSnapshot(page);
  expectAuthorizationPersistenceSafe(authorizationPersistence, {
    [LOCAL_IDENTITY_STORAGE_KEY]: LOCAL_IDENTITY_STORAGE_VALUE,
  });

  await page.goBack();
  await expect(page).toHaveURL(/\/$/u);
  await page.goForward();
  await expect(page).toHaveURL(/\/authorize$/u);
  expect(await page.evaluate(() => window.location.search)).toBe("");
  expect(await page.evaluate(() => window.location.hash)).toBe("");
  const restoredPersistence = await browserPersistenceSnapshot(page);
  expectAuthorizationPersistenceSafe(restoredPersistence, {
    [LOCAL_IDENTITY_STORAGE_KEY]: LOCAL_IDENTITY_STORAGE_VALUE,
  });
  await expectNoSensitiveBrowserLeaks(page, leakMonitor, [authorizationPersistence, restoredPersistence]);
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
  await expect(page.getByRole("heading", { name: "Invalid authorization request" })).toBeVisible();
  expect(await page.evaluate(() => window.location.search)).toBe("");
  expect(await page.evaluate(() => window.location.hash)).toBe("");
  const renderedState = await page.locator("main").innerHTML();
  for (const canary of SENSITIVE_CANARIES) expect(renderedState).not.toContain(canary);
  const persistence = await browserPersistenceSnapshot(page);
  expectAuthorizationPersistenceSafe(persistence);
  await expectNoSensitiveBrowserLeaks(page, leakMonitor, [persistence]);
});

test("reviews and scrubs a v0.10 grant authorization request", async ({ page }) => {
  const url = authorizationUrl(authorizationRequest(`${RELAY_ORIGIN}/${RELAY_PATH_CANARY}`, "grant"));
  await installLocalIdentityFixture(page);
  const leakMonitor = await installAuthorizationLeakMonitor(page);

  const response = await page.goto(url);

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/authorize$/u);
  await expect(page.getByRole("heading", { name: "Sign in to client.example" })).toBeVisible();
  await expect(page.getByText(/app-specific, revocable grant/u)).toBeVisible();
  expect(await page.locator("main").innerHTML()).not.toContain(GRANT_CLIENT_PUBLIC_KEY);
  expect(await page.evaluate(() => window.location.search)).toBe("");
  expect(await page.evaluate(() => window.location.hash)).toBe("");
  const persistence = await browserPersistenceSnapshot(page);
  expectAuthorizationPersistenceSafe(persistence, {
    [LOCAL_IDENTITY_STORAGE_KEY]: LOCAL_IDENTITY_STORAGE_VALUE,
  });
  await expectNoSensitiveBrowserLeaks(page, leakMonitor, [persistence]);
});

test("manual entry reloads into fragment-backed capability review", async ({ page }) => {
  await installLocalIdentityFixture(page);
  await page.goto("/authorize");

  await page.getByRole("textbox", { name: "Authorization link" }).fill(authorizationRequest(`${RELAY_ORIGIN}/inbox`));
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Sign in to client.example" })).toBeVisible();
  await expect(page).toHaveURL(/\/authorize$/u);
  expect(await page.evaluate(() => window.location.hash)).toBe("");
});

test("falls back to the cancel callback when the opener does not acknowledge", async ({ page }) => {
  await page.context().route("https://client.example/**", (route) => route.fulfill({
    body: "<!doctype html><title>Returned</title><h1>Returned to app</h1>",
    contentType: "text/html",
  }));
  await page.goto("/");
  await page.evaluate(({ key, value }) => window.localStorage.setItem(key, value), {
    key: LOCAL_IDENTITY_STORAGE_KEY,
    value: LOCAL_IDENTITY_STORAGE_VALUE,
  });
  const popupPromise = page.waitForEvent("popup");
  await page.evaluate((url) => { window.open(url, "pubky-passport", "popup,width=480,height=760"); }, authorizationUrl(
    authorizationRequest(`${RELAY_ORIGIN}/inbox`),
  ));
  const popup = await popupPromise;

  await popup.getByRole("button", { name: "Cancel" }).click();

  await expect(popup).toHaveURL(/https:\/\/client\.example\/authorization-cancel/u);
  await expect(popup.getByRole("heading", { name: "Returned to app" })).toBeVisible();
});

test("notifies the callback-origin opener and closes after acknowledgement", async ({ page }) => {
  await page.goto("/");
  const passportOrigin = new URL(page.url()).origin;
  await page.evaluate(({ key, value }) => window.localStorage.setItem(key, value), {
    key: LOCAL_IDENTITY_STORAGE_KEY,
    value: LOCAL_IDENTITY_STORAGE_VALUE,
  });
  await page.context().route("https://client.example/**", (route) => route.fulfill({
    body: "<!doctype html><title>Client integration</title><h1>Client integration</h1>",
    contentType: "text/html",
  }));
  await page.goto("https://client.example/integration");
  await page.evaluate((trustedPassportOrigin) => {
    window.addEventListener("message", (event) => {
      const message = event.data as Record<string, unknown>;
      if (
        event.origin !== trustedPassportOrigin
        || message.type !== "pubky-passport.authorization-outcome"
        || message.version !== 1
        || typeof message.messageId !== "string"
      ) return;
      (event.source as Window | null)?.postMessage({
        type: "pubky-passport.authorization-outcome-ack",
        version: 1,
        messageId: message.messageId,
      }, trustedPassportOrigin);
      Object.defineProperty(window, "__passportOutcome", { value: message.outcome });
    });
  }, passportOrigin);
  const popupPromise = page.waitForEvent("popup");
  const popupUrl = new URL(authorizationUrl(
    authorizationRequest(`${RELAY_ORIGIN}/inbox`),
  ), passportOrigin).href;
  await page.evaluate((url) => { window.open(url, "pubky-passport-ack", "popup,width=480,height=760"); }, popupUrl);
  const popup = await popupPromise;

  await popup.getByRole("button", { name: "Cancel" }).click();

  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(await page.evaluate(() => (window as Window & { __passportOutcome?: string }).__passportOutcome)).toBe("cancel");
});

test("uses the cancel callback for direct navigation without an opener", async ({ page }) => {
  await page.route("https://client.example/**", (route) => route.fulfill({
    body: "<!doctype html><title>Returned</title><h1>Returned to app</h1>",
    contentType: "text/html",
  }));
  await installLocalIdentityFixture(page);
  await page.goto(authorizationUrl(authorizationRequest(`${RELAY_ORIGIN}/inbox`)));

  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page).toHaveURL(/https:\/\/client\.example\/authorization-cancel/u);
  await expect(page.getByRole("heading", { name: "Returned to app" })).toBeVisible();
});

function authorizationRequest(relay: string, authenticationMethod: "cookie" | "grant" = "cookie"): string {
  const request = new URL(`pubkyauth://${authenticationMethod === "grant" ? "signin_grant" : "signin"}`);
  request.searchParams.set("caps", "/pub/example.app/:rw");
  request.searchParams.set("relay", relay);
  request.searchParams.set("secret", SENSITIVE_SECRET);
  if (authenticationMethod === "grant") {
    request.searchParams.set("cid", GRANT_CLIENT_ID);
    request.searchParams.set("cpk", GRANT_CLIENT_PUBLIC_KEY);
  }
  request.searchParams.set("x-success", `https://client.example/authorization-success?${CALLBACK_QUERY_CANARY}`);
  request.searchParams.set("x-error", `https://client.example/authorization-error?${CALLBACK_QUERY_CANARY}`);
  request.searchParams.set("x-cancel", `https://client.example/authorization-cancel?${CALLBACK_QUERY_CANARY}`);
  return request.href;
}

function authorizationUrl(request: string): string {
  return `/authorize#d=${encodeURIComponent(request)}`;
}

function cspSources(policy: string, directiveName: string): string[] {
  const directive = policy
    .split(";")
    .find((candidate) => candidate.trimStart().startsWith(`${directiveName} `));
  return directive?.trim().split(/\s+/u).slice(1) ?? [];
}

async function browserPersistenceSnapshot(page: Page) {
  return page.evaluate(async () => {
    const storageEntries = (storage: Storage) => Array.from(
      { length: storage.length },
      (_, index) => storage.key(index),
    ).filter((key): key is string => key !== null).map((key) => [key, storage.getItem(key)]);

    return {
      localStorage: Object.fromEntries(storageEntries(window.localStorage)),
      sessionStorage: Object.fromEntries(storageEntries(window.sessionStorage)),
      cookies: document.cookie,
      historyState: window.history.state,
      writes: (window as Window & { __passportPersistenceWrites?: string[] }).__passportPersistenceWrites ?? [],
      indexedDatabases: typeof indexedDB.databases === "function"
        ? (await indexedDB.databases()).map(({ name, version }) => ({ name, version }))
        : [],
      caches: "caches" in window ? await caches.keys() : [],
    };
  });
}

type BrowserPersistenceSnapshot = Awaited<ReturnType<typeof browserPersistenceSnapshot>>;

type AuthorizationLeakMonitor = {
  browserLeaks: string[];
};

async function installAuthorizationLeakMonitor(page: Page): Promise<AuthorizationLeakMonitor> {
  const browserLeaks: string[] = [];
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
    browserLeaks.push(`${outgoing.url()}\n${outgoing.postData() ?? ""}\n${outgoing.headers().referer ?? ""}`);
  });
  return { browserLeaks };
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
  expect(snapshot.writes).toEqual([]);
  expect(snapshot.indexedDatabases).toEqual([]);
  expect(snapshot.caches).toEqual([]);
}

async function installLocalIdentityFixture(page: Page): Promise<void> {
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value);
  }, { key: LOCAL_IDENTITY_STORAGE_KEY, value: LOCAL_IDENTITY_STORAGE_VALUE });
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
      writes.push(`indexedDB:${name}:${version ?? "default"}`);
      return version === undefined ? openDatabase(name) : openDatabase(name, version);
    }) as IDBFactory["open"];

    const addRecord = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = (function observedAdd(
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      writes.push(`indexedDB-add:${serialize(value)}:${serialize(key)}`);
      return key === undefined ? addRecord.call(this, value) : addRecord.call(this, value, key);
    }) as IDBObjectStore["add"];

    const putRecord = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = (function observedPut(
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      writes.push(`indexedDB-put:${serialize(value)}:${serialize(key)}`);
      return key === undefined ? putRecord.call(this, value) : putRecord.call(this, value, key);
    }) as IDBObjectStore["put"];

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
      Cache.prototype.add = (function observedCacheAdd(
        this: Cache,
        request: RequestInfo | URL,
      ) {
        writes.push(`cache-add:${requestLabel(request)}`);
        return addToCache.call(this, request);
      }) as Cache["add"];

      const addAllToCache = Cache.prototype.addAll;
      Cache.prototype.addAll = (function observedCacheAddAll(
        this: Cache,
        requests: Iterable<RequestInfo>,
      ) {
        const requestList = Array.from(requests);
        writes.push(`cache-add-all:${requestList.map(requestLabel).join(",")}`);
        return addAllToCache.call(this, requestList);
      }) as Cache["addAll"];

      const putInCache = Cache.prototype.put;
      Cache.prototype.put = (function observedCachePut(
        this: Cache,
        request: RequestInfo | URL,
        response: Response,
      ) {
        writes.push(`cache-put:${requestLabel(request)}`);
        void response.clone().text().then((body) => writes.push(`cache-response:${body}`));
        return putInCache.call(this, request, response);
      }) as Cache["put"];
    }
  });
}
