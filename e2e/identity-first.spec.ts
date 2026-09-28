import AxeBuilder from "@axe-core/playwright";
import { storeLocalIdentities } from "./helpers/localIdentities";
import { expect, test, type Page } from "./helpers/passportTest";

const FIRST = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECOND = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const REQUEST =
  "pubkyauth://signin?caps=/pub/app/:rw&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-source=Example%20App";

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
  test(`entry and reload respect ${count} saved identities`, async ({ page }) => {
    await seed(page, count);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: count ? "Your pubky." : "Quick & easy signing." }),
    ).toBeVisible();
    if (count)
      await expect(
        page.getByText(count === 1 ? "identity-0@example.com" : "identity-1@example.com", {
          exact: true,
        }),
      ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: count ? "Your pubky." : "Quick & easy signing." }),
    ).toBeVisible();
    await page.goto(`/authorize#d=${encodeURIComponent(REQUEST)}`);
    await expect(
      page.getByRole("heading", {
        name: count ? "Sign in to Example App" : "Quick & easy signing.",
      }),
    ).toBeVisible();
    // x-source is an app-chosen label; only a validated callback host fills the band.
    await expect(page.getByLabel("Signing in to Example App")).toHaveCount(0);
    if (count)
      await expect(
        page.getByText(count === 1 ? "identity-0@example.com" : "identity-1@example.com", {
          exact: true,
        }),
      ).toBeVisible();
    await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Use Pubky Ring" })).toBeEnabled();
    await page.getByRole("button", { name: "Use Pubky Ring", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in with Ring." })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open in Ring", includeHidden: true }),
    ).toHaveAttribute("href", REQUEST);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: count ? "Sign in to Example App" : "Quick & easy signing.",
      }),
    ).toBeVisible();
  });
}

test("switching persists immediately and removing the last identity returns to shared onboarding", async ({
  page,
}) => {
  await seed(page);
  await page.reload();
  await page.getByRole("button", { name: "Switch identity", exact: true }).click();
  await expect(page.locator("main")).toBeFocused();
  await page.getByRole("button", { name: /identity-0@example\.com/ }).click();
  await expect(page.getByText("identity-0@example.com", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("identity-0@example.com", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByText("identity-1@example.com", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Quick & easy signing." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import backup" })).toBeVisible();
});

test("Ring receives the original request and opening it does not approve in Passport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/authorize#d=${encodeURIComponent(REQUEST)}`);
  await page.getByRole("button", { name: "Use Pubky Ring", exact: true }).click();
  const link = page.getByRole("link", { name: "Open in Ring" });
  await expect(link).toHaveAttribute("href", REQUEST);
  // Contain the OS handoff in the test browser, while exercising the real link click.
  await link.evaluate((element) =>
    element.addEventListener("click", (event) => event.preventDefault()),
  );
  await link.click();
  await expect(page.getByRole("heading", { name: "Sign in with Ring." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Authorization complete." })).toHaveCount(0);
  await page.getByRole("button", { name: "Show QR", exact: true }).click();
  await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
  expect(
    await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })),
  ).toEqual({ local: {}, session: {} });
});

test("screens remain accessible, scroll naturally and have one footer at each viewport", async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
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
    await inspect("authorization");
    await page.getByRole("button", { name: "Switch identity", exact: true }).click();
    await inspect("switcher-with-request");
    await expect(page.getByRole("button", { name: "Use Pubky Ring", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Use Pubky Ring", exact: true }).click();
    await inspect("ring-sign-in");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in to Example App" })).toBeVisible();
    await page.getByRole("button", { name: "Switch identity", exact: true }).click();
    await page.getByRole("button", { name: "Add identity" }).click();
    await inspect("add-with-request");
    await page.getByRole("button", { name: "Use Pubky Ring", exact: true }).click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Quick & easy signing." })).toBeVisible();

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
  await expect(page.locator("button[aria-pressed]")).toHaveCount(14);
  await page.getByRole("button", { name: "Add identity" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Add identity" }).click();
  await expect(page.locator("main")).toBeFocused();
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
  await expect(page.getByRole("heading", { name: "Sign in to Example+App" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Use Pubky Ring", exact: true }).click();
  await expect(page.getByText(/too large for a QR code/)).toBeVisible();
  await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open in Ring" })).toHaveAttribute(
    "href",
    request.href,
  );
});
