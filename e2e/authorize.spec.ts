import { expect, test, type Page } from "@playwright/test";

const sensitiveSecret = "e2e-sensitive-secret";
const relayOrigin = "https://relay.client.example";
const relayPathCanary = "private-inbox";
const callbackQueryCanary = "session=sensitive";
const sensitiveCanaries = [sensitiveSecret, relayPathCanary, callbackQueryCanary];

test("scrubs a valid request and renders only safe review data", async ({ page, request }) => {
  const url = authorizationUrl(authorizationRequest(`${relayOrigin}/${relayPathCanary}?region=eu`));
  const leakMonitor = await installAuthorizationLeakMonitor(page);
  const baselineResponse = await request.get("/authorize");
  await page.goto("/");
  const response = await page.goto(url);

  expect(response?.ok()).toBe(true);
  const headers = response?.headers() ?? {};
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");

  const policy = headers["content-security-policy"] ?? "";
  const baselineSources = new Set(cspSources(baselineResponse.headers()["content-security-policy"] ?? "", "connect-src"));
  const authorizationSources = cspSources(policy, "connect-src");
  expect(authorizationSources.filter((source) => !baselineSources.has(source))).toEqual([relayOrigin]);
  expect(authorizationSources).not.toContain("https://client.example");
  expect(policy).not.toContain("/private-inbox");
  expect(policy).not.toContain(sensitiveSecret);

  await expect(page).toHaveURL(/\/authorize$/u);
  await expect(page.getByRole("heading", { name: "client.example" })).toBeVisible();
  await expect(page.getByText("relay.client.example", { exact: true })).toBeVisible();
  await expect(page.getByText("/pub/example.app/", { exact: true })).toBeVisible();

  const renderedReview = await page.locator("main").innerHTML();
  for (const canary of sensitiveCanaries) expect(renderedReview).not.toContain(canary);
  expect(renderedReview).not.toContain("authorization-success");
  expect(await page.evaluate(() => window.location.search)).toBe("");
  const authorizationPersistence = await browserPersistenceSnapshot(page);
  expectAuthorizationPersistenceEmpty(authorizationPersistence);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/u);
  await page.goForward();
  await expect(page).toHaveURL(/\/authorize$/u);
  expect(await page.evaluate(() => window.location.search)).toBe("");
  const restoredPersistence = await browserPersistenceSnapshot(page);
  expectAuthorizationPersistenceEmpty(restoredPersistence);
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
  const renderedState = await page.locator("main").innerHTML();
  for (const canary of sensitiveCanaries) expect(renderedState).not.toContain(canary);
  const persistence = await browserPersistenceSnapshot(page);
  expectAuthorizationPersistenceEmpty(persistence);
  await expectNoSensitiveBrowserLeaks(page, leakMonitor, [persistence]);
});

function authorizationRequest(relay: string): string {
  const request = new URL("pubkyauth://signin");
  request.searchParams.set("caps", "/pub/example.app/:rw");
  request.searchParams.set("relay", relay);
  request.searchParams.set("secret", sensitiveSecret);
  request.searchParams.set("x-success", `https://client.example/authorization-success?${callbackQueryCanary}`);
  request.searchParams.set("x-error", `https://client.example/authorization-error?${callbackQueryCanary}`);
  request.searchParams.set("x-cancel", `https://client.example/authorization-cancel?${callbackQueryCanary}`);
  return request.href;
}

function authorizationUrl(request: string): string {
  return `/authorize?d=${encodeURIComponent(request)}`;
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
  sawInitialSensitiveNavigation(): boolean;
};

async function installAuthorizationLeakMonitor(page: Page): Promise<AuthorizationLeakMonitor> {
  const browserLeaks: string[] = [];
  let initialSensitiveNavigationSeen = false;
  await installPersistenceObserver(page);
  page.on("console", (message) => browserLeaks.push(message.text()));
  page.on("request", (outgoing) => {
    const outgoingUrl = new URL(outgoing.url());
    const isInitialSensitiveNavigation = !initialSensitiveNavigationSeen
      && outgoing.resourceType() === "document"
      && outgoingUrl.pathname === "/authorize"
      && outgoingUrl.searchParams.has("d");
    if (isInitialSensitiveNavigation) {
      initialSensitiveNavigationSeen = true;
      return;
    }
    browserLeaks.push(`${outgoing.url()}\n${outgoing.postData() ?? ""}\n${outgoing.headers().referer ?? ""}`);
  });
  return {
    browserLeaks,
    sawInitialSensitiveNavigation: () => initialSensitiveNavigationSeen,
  };
}

async function expectNoSensitiveBrowserLeaks(
  page: Page,
  monitor: AuthorizationLeakMonitor,
  persistence: BrowserPersistenceSnapshot[],
): Promise<void> {
  expect(monitor.sawInitialSensitiveNavigation()).toBe(true);
  const observedBrowserData = JSON.stringify({
    browserLeaks: monitor.browserLeaks,
    persistence,
    cookies: await page.context().cookies(),
  });
  for (const canary of sensitiveCanaries) expect(observedBrowserData).not.toContain(canary);
}

function expectAuthorizationPersistenceEmpty(snapshot: BrowserPersistenceSnapshot): void {
  expect(snapshot.localStorage).toEqual({});
  expect(snapshot.sessionStorage).toEqual({});
  expect(snapshot.cookies).toBe("");
  expect(snapshot.historyState).toBeNull();
  expect(snapshot.writes).toEqual([]);
  expect(snapshot.indexedDatabases).toEqual([]);
  expect(snapshot.caches).toEqual([]);
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
    const openDatabase = databaseFactory.open.bind(databaseFactory);
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
      const openCache = cacheStorage.open.bind(cacheStorage);
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
