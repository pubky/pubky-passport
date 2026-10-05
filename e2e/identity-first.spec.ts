import AxeBuilder from "@axe-core/playwright";
import { storeLocalIdentities } from "./helpers/localIdentities";
import { expect, test, type Page } from "./helpers/passportTest";

const FIRST = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECOND = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const REQUEST =
  "pubkyauth://signin?caps=/pub/app/:rw&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-source=Example%20App";
const NO_WEBSITE_NOTICE =
  "This request doesn't name a website. Only continue if you just started signing in on another device.";

async function seed(page: Page, count = 2) {
  await page.goto("/");
  await storeLocalIdentities(
    page,
    [FIRST, SECOND].slice(0, count).map((publicKeyZ32, index) => ({
      publicKeyZ32,
      googleAccount: {
        googleSubject: `google-${index}`,
        name: index === 0 ? "First identity" : "Selected identity",
        email: `identity-${index}@example.com`,
        pictureUrl: null,
      },
    })),
    count > 0 ? { active: count === 1 ? FIRST : SECOND } : {},
  );
}

for (const count of [0, 1, 2]) {
  test(`entry and reload respect ${count} saved identities`, async ({ page, isMobile }) => {
    await seed(page, count);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: count ? "Your pubky." : "Get your pubky." }),
    ).toBeVisible();
    // The overview names the active identity by its key; its Google badge is left to the lists.
    if (count)
      await expect(page.getByText(count === 1 ? FIRST : SECOND, { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: count ? "Your pubky." : "Get your pubky." }),
    ).toBeVisible();
    await page.goto(`/authorize#d=${encodeURIComponent(REQUEST)}`);
    // One saved identity opens straight on its review, with nothing to switch to; its "or"
    // offers what the list does.
    if (count === 1) {
      await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Switch identity" })).toHaveCount(0);
    }
    // The list shows only where there is a choice between identities.
    const listed = count > 1 ? count : 0;
    // Otherwise a request opens on its identity list; with nothing saved, on the start page.
    // The heading names the waiting app, never by its label alone: this request has no
    // callbacks, so the line under the heading says it names no website.
    await expect(page.getByRole("heading", { name: "Signing in to Example App" })).toBeVisible();
    await expect(page.getByText(NO_WEBSITE_NOTICE)).toBeVisible();
    // x-source is an app-chosen label; only a validated callback host fills the band.
    await expect(
      page.getByRole("complementary", { name: "Signing in to Example App" }),
    ).toHaveCount(0);
    const list = page.getByRole("list", { name: "Choose the identity to sign in with." });
    await expect(list.getByRole("button")).toHaveCount(listed);
    for (let index = 0; index < count; index++)
      await expect(page.getByText(`identity-${index}@example.com`, { exact: true })).toBeVisible();
    // With identities, the list or the review offers the start page one step away; without, the
    // request opens on the start page.
    await expect(page.getByRole("button", { name: "Use another identity" })).toHaveCount(
      count ? 1 : 0,
    );
    await expect(page.getByRole("region", { name: "Create account" })).toHaveCount(count ? 0 : 1);
    await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toHaveCount(0);
    await page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
    // A computer shows the code; a phone its one button that opens Ring.
    if (isMobile)
      await expect(page.locator('main a[href^="pubkyauth:"]')).toHaveAttribute("href", REQUEST);
    else await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Signing in to Example App" })).toBeVisible();
    await expect(list.getByRole("button")).toHaveCount(listed);
  });
}

test("switching persists immediately and removing the last identity returns to shared onboarding", async ({
  page,
}) => {
  await seed(page);
  await page.reload();
  await page.getByRole("button", { name: "Switch identity", exact: true }).click();
  // Each screen names itself: its heading takes focus and titles the window.
  await expect(page.getByRole("heading", { name: "Switch identity." })).toBeFocused();
  await expect(page).toHaveTitle("Switch identity | Pubky Passport");
  // The switcher's rows carry the Google badge; the overview names the identity by its key.
  await page.getByRole("button", { name: /identity-0@example\.com/ }).click();
  await expect(page.getByText(FIRST, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(FIRST, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Remove from this browser" }).click();
  await page.getByRole("button", { name: "Remove from this browser" }).click();
  await expect(page.getByText(SECOND, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Remove from this browser" }).click();
  await page.getByRole("button", { name: "Remove from this browser" }).click();
  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import it" })).toBeVisible();
});

test("Ring receives the original request and opening it does not approve in Passport", async ({
  page,
  isMobile,
}) => {
  const handoffs: string[] = [];
  page.on("request", (outgoing) => {
    if (outgoing.url().startsWith("pubkyauth:")) handoffs.push(outgoing.url());
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/authorize#d=${encodeURIComponent(REQUEST)}`);
  await page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in with Pubky Ring." })).toBeVisible();
  // A phone follows the unchanged request at once and keeps its button to open it again, with no
  // code; a computer, even in a narrow window, shows the QR code and no link.
  const qrCode = page.getByRole("img", { name: "Pubky authorization QR code" });
  if (isMobile) {
    await expect(page.getByRole("link", { name: "Open Pubky Ring" })).toHaveAttribute(
      "href",
      REQUEST,
    );
    await expect(qrCode).toHaveCount(0);
  } else {
    await expect(qrCode).toBeVisible();
    await expect(page.locator('main a[href^="pubkyauth:"]')).toHaveCount(0);
  }
  await expect.poll(() => handoffs).toEqual(isMobile ? [REQUEST] : []);
  await expect(page.getByRole("heading", { name: /^Signed in to/u })).toHaveCount(0);
  expect(
    await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })),
  ).toEqual({ local: {}, session: {} });
});

test("screens remain accessible, scroll naturally and have one footer at each viewport", async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
  // Leaving a request the test interacted with asks first; each viewport starts afresh.
  page.on("dialog", (dialog) => void dialog.accept());
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 375, height: 812 },
    { width: 520, height: 760 },
    { width: 1024, height: 400 },
  ]) {
    await page.setViewportSize(viewport);
    await seed(page);
    await page.reload();
    await inspect("overview");
    await page.getByRole("button", { name: "Manage identity" }).click();
    await inspect("management");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Switch identity", exact: true }).click();
    await inspect("switcher");
    await page.getByRole("button", { name: "Add identity" }).click();
    await inspect("add");
    await page.goto("about:blank");
    await page.goto(`${baseURL}/authorize#d=${encodeURIComponent(REQUEST)}`);
    await inspect("choose-identity");
    await page.getByRole("button", { name: /identity-1@example\.com/u }).click();
    await inspect("authorization");
    await page.getByRole("button", { name: "Switch identity", exact: true }).click();
    await expect(page.getByRole("button", { name: /identity-0@example\.com/u })).toBeVisible();
    await page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
    await inspect("ring-sign-in");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Signing in to Example App" })).toBeVisible();
    await page.getByRole("button", { name: "Use another identity" }).click();
    await inspect("add-with-request");
    // The start page, still addressed to the app; Pubky Ring stays on the list before it.
    await expect(page.getByRole("region", { name: "Create account" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Pubky Ring/u })).toHaveCount(0);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Signing in to Example App" })).toBeVisible();

    async function inspect(name: string) {
      await expect(page.locator("main h1")).toBeVisible();
      await page.evaluate(async () => document.fonts.ready);
      const boxes = await page.evaluate(() => {
        const main = document.querySelector("main")!.getBoundingClientRect();
        const footer = document.querySelector("body > footer")!.getBoundingClientRect();
        return {
          contentBottom: main.bottom,
          footerTop: footer.top,
          width: document.documentElement.scrollWidth,
          footers: document.querySelectorAll("footer").length,
        };
      });
      expect(boxes.footers).toBe(1);
      expect(boxes.footerTop).toBeGreaterThanOrEqual(boxes.contentBottom - 1);
      expect(boxes.width).toBeLessThanOrEqual(viewport.width);
      if (viewport.height >= 760)
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`${name}-${viewport.width}x${viewport.height}.png`),
        fullPage: true,
      });
    }
  }
});

test("long identity and permission lists stay inside the page with a separated footer", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 520, height: 760 });
  await seed(page);
  const longIdentities = [..."ybndrfg8ejkm"].map((letter, index) => ({
    publicKeyZ32: FIRST.slice(0, -3) + letter + "yy",
    googleAccount: {
      googleSubject: `long-${index}`,
      name: "A very long identity name that should fit inside its own row without horizontal scrolling",
      email: "an-extremely-long-account-email-address@example.com",
      pictureUrl: null,
    },
  }));
  await storeLocalIdentities(page, longIdentities, {
    active: longIdentities.at(-1)!.publicKeyZ32,
    replace: false,
  });
  await page.reload();
  await page.getByRole("button", { name: "Switch identity", exact: true }).click();
  const saved = page.getByRole("list", { name: "Saved identities" });
  await expect(saved.getByRole("listitem")).toHaveCount(14);
  await expect(saved.locator('button[aria-current="true"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Add identity" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Add identity" }).click();
  await expect(page.locator("main h1")).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const request = new URL(REQUEST);
  request.searchParams.set(
    "caps",
    Array.from({ length: 20 }, (_, index) => `/pub/long-app-name-${index}/:rw`).join(","),
  );
  request.searchParams.set(
    "x-source",
    "An exceptionally long requester name to review many permissions on a small screen",
  );
  await page.goto("about:blank");
  await page.goto(`${baseURL}/authorize#d=${encodeURIComponent(request.href)}`);
  // The list fills the window and scrolls inside it, so the other ways in stay in view.
  const list = page.getByRole("list", { name: "Choose the identity to sign in with." });
  await expect(list.getByRole("button")).toHaveCount(14);
  const choice = await page.evaluate(() => {
    const list = document.querySelector("main ul")!;
    const ring = [...document.querySelectorAll("main button")].find(
      (button) => button.textContent?.trim() === "Continue with Pubky Ring",
    )!;
    return {
      scrolls: list.scrollHeight > list.clientHeight,
      ringBottom: ring.getBoundingClientRect().bottom,
      width: document.documentElement.scrollWidth,
    };
  });
  expect(choice.scrolls).toBe(true);
  expect(choice.ringBottom).toBeLessThanOrEqual(760);
  expect(choice.width).toBeLessThanOrEqual(520);
  await list.getByRole("button").last().scrollIntoViewIfNeeded();
  await list.getByRole("button").last().click();
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Authorize", exact: true }).scrollIntoViewIfNeeded();
  const layout = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    contentBottom: document.querySelector("main")!.getBoundingClientRect().bottom,
    footerTop: document.querySelector("footer")!.getBoundingClientRect().top,
  }));
  expect(layout.width).toBeLessThanOrEqual(520);
  expect(layout.footerTop).toBeGreaterThanOrEqual(layout.contentBottom - 1);
});

test("a valid request larger than QR capacity still supports explicit approval and exact Ring handoff", async ({
  page,
  baseURL,
  isMobile,
}) => {
  await seed(page);
  const request = new URL(REQUEST);
  request.searchParams.set(
    "caps",
    Array.from(
      { length: 6 },
      (_, index) => `/pub/${"a".repeat(240)}/${"b".repeat(240)}/app${index}/:rw`,
    ).join(","),
  );
  await page.goto("about:blank");
  await page.goto(`${baseURL}/authorize#d=${encodeURIComponent(request.href)}`);
  await expect(page.getByRole("heading", { name: "Signing in to Example+App" })).toBeVisible();
  await page.getByRole("button", { name: /identity-1@example\.com/u }).click();
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Switch identity", exact: true }).click();
  await page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
  // Without a QR code, opening Ring on this device is the only way, on any pointer. A computer
  // says why it shows no code; a phone never shows one, so it has nothing to explain.
  await expect(page.locator('main a[href^="pubkyauth:"]')).toHaveAttribute("href", request.href);
  await expect(page.getByText(/too big for a QR code/)).toHaveCount(isMobile ? 0 : 1);
  await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toHaveCount(0);
});
