import { createHash } from "node:crypto";
import { test, expect, type Page, type BrowserContext } from "./helpers/passportTest";
import { UNVERIFIED_BAND, UNVERIFIED_HEADING, UNVERIFIED_WARNING } from "./helpers/requester";

const CLIENT_ORIGIN = "https://client.example";
const ATTEMPT_ID = "0123456789abcdef";
const SECRET = ["kqnceEMgrNQM_xi06oQXjA3c", "JHX_RQmw1BY6JE1bse8"].join("");
const HELLO = {
  type: "pubky-passport.hello",
  version: 2,
  attemptId: ATTEMPT_ID,
  features: ["outcome-v2", "status"],
  // These specs cover the channel and the band; a required profile puts its own step before the
  // review, which e2e/passport-client.spec.ts covers.
  profile: "optional",
};
type HarnessWindow = Window & {
  __channelHarness: {
    popup: Window | null;
    messages: Record<string, unknown>[];
    send: (hello: unknown) => void;
  };
};

function requestPath(cancelCallback?: string): string {
  const request = `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=${SECRET}${cancelCallback ? `&x-cancel=${encodeURIComponent(cancelCallback)}` : ""}`;
  return `/authorize#d=${encodeURIComponent(request)}`;
}

/** The request digest each harness page's hello carries (A40), keyed by the opener page. */
const digests = new WeakMap<Page, string>();
function digest(request: string): string {
  return createHash("sha256").update(request, "utf8").digest("base64url");
}

async function openPassport(page: Page, baseURL: string, path: string, origin = CLIENT_ORIGIN) {
  const passportOrigin = new URL(baseURL).origin;
  const fragment = new URL(path, baseURL).hash;
  if (fragment.startsWith("#d="))
    digests.set(page, digest(decodeURIComponent(fragment.slice("#d=".length))));
  await page.context().route(/https?:\/\//u, (route) => {
    const url = new URL(route.request().url());
    if (url.origin === passportOrigin) return route.fallback();
    if (url.origin === origin)
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Client integration</title><h1>Client integration</h1>",
      });
    return route.abort();
  });
  await page.goto(`${origin}/integration`);
  const popupPromise = page.waitForEvent("popup");
  await page.evaluate(
    ({ url, passportOrigin }) => {
      const harness: HarnessWindow["__channelHarness"] = {
        popup: null,
        messages: [],
        send: (hello) => harness.popup?.postMessage(hello, passportOrigin),
      };
      Object.defineProperty(window, "__channelHarness", { value: harness });
      window.addEventListener("message", (event) => {
        if (event.origin !== passportOrigin || event.source !== harness.popup) return;
        harness.messages.push(event.data as Record<string, unknown>);
      });
      harness.popup = window.open(url, "passport-channel-test", "popup,width=520,height=760");
    },
    { url: new URL(path, baseURL).href, passportOrigin },
  );
  return popupPromise;
}

async function sendHello(page: Page, message: unknown = HELLO): Promise<void> {
  // A hello names the request this harness opened unless the test sets its own digest.
  if (
    message !== null &&
    typeof message === "object" &&
    (message as Record<string, unknown>).type === "pubky-passport.hello" &&
    !("request" in message)
  )
    message = { ...message, request: digests.get(page) };
  await page.evaluate(
    (hello) => (window as unknown as HarnessWindow).__channelHarness.send(hello),
    message,
  );
}
async function messages(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(() => (window as unknown as HarnessWindow).__channelHarness.messages);
}

async function seedPassportIdentity(context: BrowserContext, baseURL: string): Promise<void> {
  await context.addInitScript((origin) => {
    if (location.origin !== origin) return;
    const key = ["tkrq8zmwb8a3m9k15csu3q17qm", "fgqnp9dskbrg9uq1rydpyxp7qy"].join("");
    const secretKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(1))).replace(/=+$/u, "");
    localStorage.setItem(
      `pubky-passport/local-identities/v1/identity/${key}`,
      JSON.stringify({ v: 1, publicKeyZ32: key, secretKey }),
    );
    localStorage.setItem("pubky-passport/local-identities/v1/active", key);
  }, new URL(baseURL).origin);
}

/** One identity is saved, so the request opens straight on its review. */
async function expectSavedIdentityReview(popup: Page): Promise<void> {
  await expect(popup.getByRole("button", { name: "Authorize", exact: true })).toBeVisible();
}

async function acknowledgeOutcomes(page: Page, baseURL: string): Promise<void> {
  await page.evaluate(
    ({ origin, attemptId }) => {
      const harness = (window as unknown as HarnessWindow).__channelHarness;
      window.addEventListener("message", (event) => {
        if (event.source !== harness.popup || event.origin !== origin) return;
        const data = event.data as Record<string, unknown>;
        if (
          data.type !== "pubky-passport.authorization-outcome" ||
          data.version !== 2 ||
          data.attemptId !== attemptId ||
          typeof data.messageId !== "string"
        )
          return;
        harness.popup?.postMessage(
          {
            type: "pubky-passport.authorization-outcome-ack",
            version: 2,
            attemptId,
            messageId: data.messageId,
          },
          origin,
        );
      });
    },
    { origin: new URL(baseURL).origin, attemptId: ATTEMPT_ID },
  );
}
async function expectReady(page: Page, request: Record<string, string>): Promise<void> {
  await expect
    .poll(async () => {
      await sendHello(page);
      return (await messages(page)).at(-1);
    })
    .toEqual({
      type: "pubky-passport.ready",
      version: 2,
      attemptId: ATTEMPT_ID,
      protocols: [1, 2],
      features: ["outcome-v2", "status", "profile-setup"],
      request,
    });
}

test("a first hello during the Ring view gets ready then Ring, and the Ring view sends no outcome", async ({
  page,
  baseURL,
}) => {
  const popup = await openPassport(page, baseURL!, requestPath());
  await popup.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
  expect(await messages(page)).toEqual([]);
  await sendHello(page);
  await expect.poll(() => messages(page)).toHaveLength(2);
  const bound = await messages(page);
  expect(bound.map((message) => message.type)).toEqual([
    "pubky-passport.ready",
    "pubky-passport.status",
  ]);
  expect(bound[0]?.request).toEqual({ status: "valid" });
  expect(bound[1]).toEqual({
    type: "pubky-passport.status",
    version: 2,
    attemptId: ATTEMPT_ID,
    phase: "ring",
  });
  // Nothing to report in Passport: the app's own SDK gets Ring's answer.
  await expect(popup.getByRole("button", { name: /approved|Back to /u })).toHaveCount(0);
  await sendHello(page);
  await expect.poll(() => messages(page)).toHaveLength(3);
  expect((await messages(page))[2]?.request).toEqual({ status: "valid" });
  expect(
    (await messages(page)).some(
      (message) => message.type === "pubky-passport.authorization-outcome",
    ),
  ).toBe(false);
  expect(popup.isClosed()).toBe(false);
  await popup.close();
});

test("ready is byte-identical before user action with and without stored identities", async ({
  page,
  baseURL,
}) => {
  const empty = await openPassport(page, baseURL!, requestPath());
  await expect(empty.getByRole("button", { name: "Import it", exact: true })).toBeVisible();
  await expectReady(page, { status: "valid" });
  const withoutIdentity = JSON.stringify((await messages(page))[0]);
  expect((await messages(page)).every((message) => message.type === "pubky-passport.ready")).toBe(
    true,
  );
  await empty.close();

  await seedPassportIdentity(page.context(), baseURL!);
  const stored = await openPassport(page, baseURL!, requestPath());
  // One stored identity: its review is the first screen.
  await expect(stored.getByRole("button", { name: "Authorize", exact: true })).toBeVisible();
  await expectReady(page, { status: "valid" });
  expect(JSON.stringify((await messages(page))[0])).toBe(withoutIdentity);
  expect((await messages(page)).every((message) => message.type === "pubky-passport.ready")).toBe(
    true,
  );
  await stored.close();
});

test("granting follows the explicit Authorize commit and carries no identity", async ({
  page,
  baseURL,
}) => {
  await seedPassportIdentity(page.context(), baseURL!);
  const popup = await openPassport(page, baseURL!, requestPath());
  await expectReady(page, { status: "valid" });
  await expectSavedIdentityReview(popup);
  await expect(popup.getByRole("button", { name: "Authorize", exact: true })).toBeVisible();
  expect(
    (await messages(page)).filter((message) => message.type === "pubky-passport.status"),
  ).toEqual([]);
  await popup.getByRole("button", { name: "Authorize", exact: true }).click();
  await expect
    .poll(async () =>
      (await messages(page)).filter((message) => message.type === "pubky-passport.status"),
    )
    .toEqual([
      { type: "pubky-passport.status", version: 2, attemptId: ATTEMPT_ID, phase: "granting" },
    ]);
  expect(JSON.stringify(await messages(page))).not.toContain(SECRET);
  await popup.close();
});

for (const [name, path, request] of [
  ["valid", requestPath(), { status: "valid" }],
  [
    "invalid fragment",
    "/authorize#other=value",
    { status: "invalid", code: "invalid_fragment_shape" },
  ],
  ["invalid search", "/authorize?d=invalid", { status: "invalid", code: "invalid_search" }],
] as const) {
  test(`replies before identity setup with the ${name} request state`, async ({
    page,
    baseURL,
  }) => {
    const popup = await openPassport(page, baseURL!, path);
    await expectReady(page, request);
    await expect(popup).toHaveURL(new URL("/authorize", baseURL!).href);
    expect(JSON.stringify(await messages(page))).not.toContain(SECRET);
    const response = await popup.request.get(new URL("/authorize", baseURL!).href);
    expect([undefined, "unsafe-none"]).toContain(response.headers()["cross-origin-opener-policy"]);
    expect(await popup.evaluate(() => window.opener !== null)).toBe(true);
  });
}

test("an expired pre-hydration capture reports expired without request content", async ({
  page,
  context,
  baseURL,
}) => {
  // Advance Date only after the real parser-time script has captured its deadline.
  await context.addInitScript(() => {
    const define = Object.defineProperty;
    Object.defineProperty = function (target, property, descriptor) {
      const result = define(target, property, descriptor);
      if (target === window && property === "__takePassportAuthorizationLocation") {
        const now = Date.now.bind(Date);
        Date.now = () => now() + 120_000;
        Object.defineProperty = define;
      }
      return result;
    };
  });
  await openPassport(page, baseURL!, requestPath());
  await expectReady(page, { status: "expired" });
  expect(JSON.stringify(await messages(page))).not.toContain(SECRET);
});

test("a reloaded popup lands on home and answers empty", async ({ page, baseURL }) => {
  const popup = await openPassport(page, baseURL!, requestPath());
  await expectReady(page, { status: "valid" });
  await popup.reload();
  await expect(popup).toHaveURL(new URL("/", baseURL!).href);
  await expectReady(page, { status: "empty" });
  expect(await popup.evaluate(() => window.opener !== null)).toBe(true);
});

test("home keeps answering only empty while identity-management UI changes", async ({
  page,
  baseURL,
}) => {
  const popup = await openPassport(page, baseURL!, "/");
  await expectReady(page, { status: "empty" });
  await popup.getByRole("button", { name: "Import it", exact: true }).click();
  await expectReady(page, { status: "empty" });
  expect(
    (await messages(page)).every(
      (message) =>
        message.type === "pubky-passport.ready" &&
        JSON.stringify(message.request) === '{"status":"empty"}',
    ),
  ).toBe(true);
  const response = await popup.request.get(new URL("/", baseURL!).href);
  expect([undefined, "unsafe-none"]).toContain(response.headers()["cross-origin-opener-policy"]);
});

test("ignores other windows and attempt ids after the opener binds", async ({ page, baseURL }) => {
  const popup = await openPassport(page, baseURL!, requestPath());
  await expect(popup.getByRole("button", { name: "Import it", exact: true })).toBeVisible();
  // Send once after installation: a retrying hello can leave an extra ready in flight.
  await sendHello(page);
  await expect
    .poll(() => messages(page))
    .toMatchObject([
      {
        type: "pubky-passport.ready",
        version: 2,
        attemptId: ATTEMPT_ID,
        request: { status: "valid" },
      },
    ]);
  const accepted = (await messages(page))[0]!;
  // Runs after the real channel for the same rejected event, so no reply can lag behind this marker.
  await popup.evaluate(
    ({ origin, attemptId }) => {
      window.addEventListener("message", (event) => {
        if (event.data?.type !== "pubky-passport.hello") return;
        const sender = event.source === window.opener ? "opener" : "other";
        if (sender === "opener" && event.data.attemptId === attemptId) return;
        window.opener.postMessage({ barrier: "rejected-hello", sender }, origin);
      });
    },
    { origin: CLIENT_ORIGIN, attemptId: ATTEMPT_ID },
  );
  await sendHello(page, { ...HELLO, attemptId: "other-attempt-0123" });
  const rejectedAttempt = { barrier: "rejected-hello", sender: "opener" };
  await expect.poll(() => messages(page)).toEqual([accepted, rejectedAttempt]);
  await page.evaluate((origin) => {
    const iframe = document.createElement("iframe");
    iframe.src = origin + "/other-window";
    document.body.append(iframe);
  }, CLIENT_ORIGIN);
  await expect
    .poll(() =>
      page
        .frames()
        .find((frame) => frame.url().endsWith("/other-window"))
        ?.url(),
    )
    .toBe(`${CLIENT_ORIGIN}/other-window`);
  await page
    .frames()
    .find((frame) => frame.url().endsWith("/other-window"))!
    .evaluate(
      ({ hello, targetOrigin }) => {
        (window.parent as HarnessWindow).__channelHarness.popup?.postMessage(hello, targetOrigin);
      },
      { hello: HELLO, targetOrigin: new URL(baseURL!).origin },
    );
  const rejectedSource = { barrier: "rejected-hello", sender: "other" };
  await expect.poll(() => messages(page)).toEqual([accepted, rejectedAttempt, rejectedSource]);
  await sendHello(page);
  await expect
    .poll(() => messages(page))
    .toEqual([accepted, rejectedAttempt, rejectedSource, accepted]);
});

test("a bound opener cannot switch its origin by navigating", async ({ page, baseURL }) => {
  const popup = await openPassport(page, baseURL!, requestPath());
  await expectReady(page, { status: "valid" });
  // WebKit severs the opener on cross-site navigation; a same-site origin keeps it testable.
  const other = "https://other.client.example";
  await page
    .context()
    .route(`${other}/**`, (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Other app</title>" }),
    );
  await page.goto(`${other}/integration`);
  const passportOrigin = new URL(baseURL!).origin;
  await page.evaluate(
    ({ passportOrigin, hello }) => {
      const received: unknown[] = [];
      Object.defineProperty(window, "__received", { value: received });
      window.addEventListener("message", (event) => {
        if (event.origin !== passportOrigin) return;
        if (event.data.type === "test.popup-reference") {
          (event.source as Window).postMessage(hello, passportOrigin);
        } else received.push(event.data);
      });
    },
    { passportOrigin, hello: HELLO },
  );
  await popup.evaluate((otherOrigin) => {
    // A real post from the same WindowProxy now has the new document's origin.
    window.addEventListener(
      "message",
      (event) => {
        if (event.source === window.opener && event.origin === otherOrigin)
          window.opener.postMessage({ barrier: true }, otherOrigin);
      },
      { once: true },
    );
    window.opener.postMessage({ type: "test.popup-reference" }, otherOrigin);
  }, other);
  const received = () =>
    page.evaluate(() => (window as Window & { __received?: unknown[] }).__received);
  await expect.poll(received).toEqual([{ barrier: true }]);
});

test("a late hello bound to this request names its opener in the band, never as verified", async ({
  page,
  baseURL,
}, testInfo) => {
  await seedPassportIdentity(page.context(), baseURL!);
  const request = new URL(
    `pubkyauth://signin_grant?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=${SECRET}`,
  );
  request.searchParams.set("cid", "claimed-client.example");
  request.searchParams.set(
    "cpk",
    ["5jsjx1o6fzu6aeeo697r3i5rx15z", "q41kikcye8wtwdqm4nb4tryo"].join(""),
  );
  request.searchParams.set("x-source", "ClaimedApp");
  request.searchParams.set("x-cancel", "https://callback.example/cancel");
  const popup = await openPassport(
    page,
    baseURL!,
    `/authorize#d=${encodeURIComponent(request.href)}`,
  );
  await expectSavedIdentityReview(popup);
  // M3: before a hello nothing names the requester, not even the validated callback host.
  await expect(popup.getByRole("heading", UNVERIFIED_HEADING)).toBeVisible();
  await expect(
    popup.getByRole("complementary", { name: "Signing in to callback.example" }),
  ).toHaveCount(0);
  await expectReady(page, { status: "valid" });
  // A39: the opener bound to this request by its digest names it; the heading keeps the app's label.
  await expect(
    popup.getByRole("complementary", { name: "Signing in to client.example" }),
  ).toBeVisible();
  await expect(popup.getByRole("heading", { name: "Signing in to ClaimedApp" })).toBeVisible();
  await expect(popup.getByText(/verified|given by the app/iu)).toHaveCount(0);
  await expect(
    popup.getByText(
      "This app asks to return you to callback.example, which is not client.example.",
    ),
  ).toHaveCount(2);
  await expect(popup.getByRole("button", { name: "Authorize", exact: true })).toBeEnabled();
  expect(await popup.locator("body").textContent()).not.toContain(SECRET);
  for (const width of [375, 520]) {
    await popup.setViewportSize({ width, height: 812 });
    await popup.evaluate(async () => document.fonts.ready);
    expect(await popup.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await popup.screenshot({
      path: testInfo.outputPath(`verified-requester-${width}.png`),
      fullPage: true,
    });
  }
  await popup.close();
});

test("A40: a hello for another request never names its opener", async ({ page, baseURL }) => {
  await seedPassportIdentity(page.context(), baseURL!);
  const popup = await openPassport(page, baseURL!, requestPath());
  // A re-navigated named popup holds another request: the app's hello names its own digest.
  await sendHello(page, { ...HELLO, request: digest("pubkyauth://another-request") });
  await expectSavedIdentityReview(popup);
  // Nobody verified who asks: the band and the review say so.
  await expect(popup.getByText(UNVERIFIED_WARNING)).toBeVisible();
  await expect(popup.getByRole("complementary", UNVERIFIED_BAND)).toBeVisible();
  expect(await messages(page)).toEqual([]);
  await expectReady(page, { status: "valid" });
  await expect(
    popup.getByRole("complementary", { name: "Signing in to client.example" }),
  ).toBeVisible();
  await expect(popup.getByText(UNVERIFIED_WARNING)).toHaveCount(0);
});

for (const [origin, suffix] of [
  ["https://accounts.google.com.secure-login.attacker-example.net", "attacker-example.net"],
  ["http://localhost:5173", ":5173"],
]) {
  test(`the band keeps the identifying suffix visible for ${origin}`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await seedPassportIdentity(page.context(), baseURL!);
    const popup = await openPassport(page, baseURL!, requestPath(), origin);
    await expectReady(page, { status: "valid" });
    await popup.setViewportSize({ width: 375, height: 812 });
    const host = popup.locator("[data-requester-host]");
    await expect(host).toBeVisible();
    await expect(host).toContainText(suffix!);
    await popup.evaluate(async () => document.fonts.ready);
    expect(
      await host.evaluate((clip, suffix) => {
        const text = clip.querySelector("bdi")!.firstChild!;
        const start = text.textContent!.indexOf(suffix);
        const range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + suffix.length);
        const box = clip.getBoundingClientRect();
        return [...range.getClientRects()].every(
          (rect) => rect.left >= box.left - 1 && rect.right <= box.right + 1,
        );
      }, suffix!),
    ).toBe(true);
    await popup.screenshot({
      path: testInfo.outputPath(`host-suffix-${suffix === ":5173" ? "loopback" : "domain"}.png`),
      fullPage: true,
    });
    await popup.close();
  });
}

for (const width of [375, 520]) {
  test(`foreign callback warnings fit both surfaces at ${width}px`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await seedPassportIdentity(page.context(), baseURL!);
    const openerHost = "accounts.google.com.secure-login.attacker-example.net";
    const callbackHost = `returns.${"r".repeat(60)}.example`;
    const popup = await openPassport(
      page,
      baseURL!,
      requestPath(`https://${callbackHost}/cancel`),
      `https://${openerHost}`,
    );
    await expectReady(page, { status: "valid" });
    await expectSavedIdentityReview(popup);
    await expect(
      popup.getByRole("complementary", { name: `Signing in to ${openerHost}` }),
    ).toBeVisible();
    await popup.setViewportSize({ width, height: 812 });
    const text = `This app asks to return you to ${callbackHost}, which is not ${openerHost}.`;
    const warnings = popup.getByText(text, { exact: true });
    await expect(warnings).toHaveCount(2);
    for (const warning of await warnings.all()) {
      await expect(warning).toBeVisible();
      expect(await warning.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
    const band = popup.locator("[data-passport-context-band]");
    const measure = () =>
      band.getByText(text, { exact: true }).evaluate((node) => {
        const band = node.closest("[data-passport-context-band]")!.getBoundingClientRect();
        const warning = node.getBoundingClientRect();
        const header = document.querySelector("body > header")!;
        const logo = header.firstElementChild!.getBoundingClientRect();
        return {
          bandTop: band.top,
          bandBottom: band.bottom,
          bandHeight: band.height,
          warningTop: warning.top,
          warningBottom: warning.bottom,
          logoTop: logo.top,
          headerPadding: Number.parseFloat(getComputedStyle(header).paddingTop),
        };
      });
    // Viewport resizing and ResizeObserver delivery occur in separate browser steps.
    await expect
      .poll(async () => {
        const bounds = await measure();
        return bounds.headerPadding - bounds.bandHeight;
      })
      .toBeGreaterThanOrEqual(0);
    const bounds = await measure();
    expect(bounds.warningTop).toBeGreaterThanOrEqual(bounds.bandTop);
    expect(bounds.warningBottom).toBeLessThanOrEqual(bounds.bandBottom);
    expect(bounds.headerPadding).toBeGreaterThanOrEqual(bounds.bandHeight);
    expect(bounds.logoTop).toBeGreaterThanOrEqual(bounds.bandBottom);
    await expect(popup.getByRole("button", { name: "Authorize", exact: true })).toBeEnabled();
    await popup.screenshot({
      path: testInfo.outputPath(`16-warning-contained-${width}.png`),
      fullPage: true,
    });
    await popup.close();
  });
}

test("unsafe grant client IDs do not grow the band or prevent approval", async ({
  page,
  baseURL,
}, testInfo) => {
  await seedPassportIdentity(page.context(), baseURL!);
  const request = new URL(
    `pubkyauth://signin_grant?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=${SECRET}`,
  );
  request.searchParams.set("cid", "app\u2028verified by your browser");
  request.searchParams.set(
    "cpk",
    ["5jsjx1o6fzu6aeeo697r3i5rx15z", "q41kikcye8wtwdqm4nb4tryo"].join(""),
  );
  const popup = await openPassport(
    page,
    baseURL!,
    `/authorize#d=${encodeURIComponent(request.href)}`,
  );
  await expectReady(page, { status: "valid" });
  await expectSavedIdentityReview(popup);
  await popup.setViewportSize({ width: 375, height: 812 });
  await expect(popup.getByRole("button", { name: "Authorize", exact: true })).toBeEnabled();
  await expect(popup.getByText(/Client ID given by the app/u)).toHaveCount(0);
  const band = popup.locator("[data-passport-context-band]");
  expect(
    await band.evaluate((node) => ({
      height: node.getBoundingClientRect().height,
      content: node.scrollHeight,
    })),
  ).toEqual({ height: 34, content: 33 });
  await popup.screenshot({ path: testInfo.outputPath("unsafe-cid-omitted.png"), fullPage: true });
  await popup.close();
});

test("review without provenance or claims has one normal gap before permissions", async ({
  page,
  baseURL,
}) => {
  await seedPassportIdentity(page.context(), baseURL!);
  for (const origin of [CLIENT_ORIGIN, "http://localhost:5173"]) {
    const popup = await openPassport(page, baseURL!, requestPath(), origin);
    if (origin.startsWith("http:")) await expectReady(page, { status: "valid" });
    await expectSavedIdentityReview(popup);
    const heading = popup.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    await popup.setViewportSize({ width: 375, height: 812 });
    expect(
      await heading.evaluate((node) => {
        const group = node.parentElement!;
        return (
          group.nextElementSibling!.getBoundingClientRect().top -
          group.getBoundingClientRect().bottom
        );
      }),
    ).toBeCloseTo(24, 0);
    await popup.close();
  }
});

test("an HTTP loopback opener is visibly a local development app", async ({ page, baseURL }) => {
  await seedPassportIdentity(page.context(), baseURL!);
  const origin = "http://localhost:5173";
  const popup = await openPassport(page, baseURL!, requestPath(), origin);
  await expectReady(page, { status: "valid" });
  await expectSavedIdentityReview(popup);
  await expect(
    popup.getByRole("complementary", { name: `Signing in to Local development app (${origin})` }),
  ).toBeVisible();
  await expect(popup.getByText(UNVERIFIED_WARNING)).toHaveCount(0);
  await expect(popup.getByText(/verified/iu)).toHaveCount(0);
  await popup.close();
});

test("v2 cancel without callbacks closes only after acknowledgment", async ({
  page,
  context,
  baseURL,
}) => {
  await seedPassportIdentity(context, baseURL!);
  const popup = await openPassport(page, baseURL!, requestPath());
  await expectReady(page, { status: "valid" });
  await acknowledgeOutcomes(page, baseURL!);
  await popup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(
    (await messages(page)).filter(
      (message) => message.type === "pubky-passport.authorization-outcome",
    ),
  ).toEqual([
    {
      type: "pubky-passport.authorization-outcome",
      version: 2,
      attemptId: ATTEMPT_ID,
      messageId: expect.any(String),
      outcome: "cancel",
    },
  ]);
});

test("a missing v2 ack stays local without callbacks and reports completed", async ({
  page,
  context,
  baseURL,
}) => {
  await seedPassportIdentity(context, baseURL!);
  const popup = await openPassport(page, baseURL!, requestPath());
  await expectReady(page, { status: "valid" });
  await popup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(popup.getByRole("heading", { name: "Sign-in cancelled." })).toBeVisible();
  expect(popup.isClosed()).toBe(false);
  await expectReady(page, { status: "completed" });
});

test("a late first hello after a local cancel receives completed with no outcome replay", async ({
  page,
  context,
  baseURL,
}) => {
  await seedPassportIdentity(context, baseURL!);
  const popup = await openPassport(page, baseURL!, requestPath());
  await popup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(popup.getByRole("heading", { name: "Sign-in cancelled." })).toBeVisible();
  await expectReady(page, { status: "completed" });
  expect((await messages(page)).every((message) => message.type === "pubky-passport.ready")).toBe(
    true,
  );
});

test("v2 posts to the opener before falling back to an exact foreign-origin callback", async ({
  page,
  context,
  baseURL,
}) => {
  const callback = "https://return.example/cancel?opaque=callback-canary";
  await seedPassportIdentity(context, baseURL!);
  const popup = await openPassport(page, baseURL!, requestPath(callback));
  await context.route("https://return.example/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><h1>Callback reached</h1>" }),
  );
  await expectReady(page, { status: "valid" });
  await expectSavedIdentityReview(popup);
  await expect(
    popup.getByText("This app asks to return you to return.example, which is not client.example."),
  ).toHaveCount(2);
  await expect(popup.getByRole("button", { name: "Authorize", exact: true })).toBeEnabled();
  await popup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect
    .poll(async () =>
      (await messages(page)).some(
        (message) =>
          message.type === "pubky-passport.authorization-outcome" && message.outcome === "cancel",
      ),
    )
    .toBe(true);
  await expect(popup).toHaveURL(callback);
  await expect(popup.getByRole("heading", { name: "Callback reached" })).toBeVisible();
  expect(JSON.stringify(await messages(page))).not.toContain("callback-canary");
});

test("a failed SDK relay approval sends only the safe v2 reason", async ({
  page,
  context,
  baseURL,
}) => {
  await seedPassportIdentity(context, baseURL!);
  const popup = await openPassport(page, baseURL!, requestPath());
  await expectReady(page, { status: "valid" });
  await acknowledgeOutcomes(page, baseURL!);
  await expectSavedIdentityReview(popup);
  await popup.getByRole("button", { name: "Authorize", exact: true }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(
    (await messages(page)).filter(
      (message) => message.type === "pubky-passport.authorization-outcome",
    ),
  ).toEqual([
    {
      type: "pubky-passport.authorization-outcome",
      version: 2,
      attemptId: ATTEMPT_ID,
      messageId: expect.any(String),
      outcome: "error",
      code: "relay_unreachable",
    },
  ]);
  expect(JSON.stringify(await messages(page))).not.toContain(SECRET);
});

for (const origin of [
  "http://localhost.evil.com",
  "http://localhost.",
  "http://127.0.0.2",
  "http://[::2]",
]) {
  test(`ignores a hello from the loopback look-alike ${origin}`, async ({ page, baseURL }) => {
    const popup = await openPassport(page, baseURL!, requestPath(), origin);
    await expect(popup.getByRole("button", { name: "Import it", exact: true })).toBeVisible();
    // This listener runs after the installed channel handles the same hello.
    await popup.evaluate(
      (targetOrigin) =>
        window.addEventListener(
          "message",
          (event) => {
            if (event.origin === targetOrigin && event.source === window.opener)
              window.opener.postMessage({ barrier: true }, targetOrigin);
          },
          { once: true },
        ),
      origin,
    );
    await sendHello(page);
    await expect.poll(async () => (await messages(page)).at(-1)).toEqual({ barrier: true });
    expect(await messages(page)).toEqual([{ barrier: true }]);
  });
}
