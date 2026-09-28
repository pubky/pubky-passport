import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./helpers/passportTest";
import {
  mockPublicProfile,
  seedProfileIdentity,
  IDENTITY_STORAGE_KEY,
  PROFILE_KEY,
} from "./helpers/pubkyProfile";

const PROFILE = {
  name: "Satoshi",
  bio: "Authored the Bitcoin white paper, developed Bitcoin, mined 1st block.",
  links: [
    { title: "Website", url: "https://www.bitcoin.org/" },
    { title: "X (Twitter)", url: "https://x.com/satoshi" },
  ],
  image: null,
  status: null,
};

test("profile setup follows Figma, preserves identity on reload and failed saves", async ({
  page,
}, info) => {
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page);
  await expect(page.getByRole("heading", { name: "Create your profile." })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("profile-empty.png"), fullPage: true });
  await expect(page.locator("main")).toBeFocused();
  await page.getByLabel("Name", { exact: true }).fill(PROFILE.name);
  await page.getByLabel("Bio", { exact: true }).fill(PROFILE.bio);
  await page.getByLabel("Website", { exact: true }).fill(PROFILE.links[0]!.url);
  await page.getByLabel("X (Twitter)", { exact: true }).fill("@satoshi");
  await page.getByLabel("Choose avatar file").setInputFiles("e2e/fixtures/profile-avatar.png");
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Profile avatar preview" })).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await page.screenshot({ path: info.outputPath("profile-filled.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose backup method" })).toBeVisible();
  await expect(page.locator("main")).toBeFocused();
  await page.screenshot({ path: info.outputPath("profile-backup-methods.png"), fullPage: true });
  await page.getByRole("button", { name: "Continue to profile" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Satoshi");
  // The avatar is re-encoded in the browser, then the homeserver answers the session with a 503.
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Could not save your profile",
    {
      timeout: 15000,
    },
  );
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).profileSetupRequired,
      IDENTITY_STORAGE_KEY,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Create your profile." })).toBeVisible();
});

test("an unreadable published profile opens an empty editor instead of blocking setup", async ({
  page,
}) => {
  await mockPublicProfile(page, { name: "x" });
  await seedProfileIdentity(page);
  await expect(page.getByRole("heading", { name: "Create your profile." })).toBeVisible();
  await expect(page.getByText("Your published profile could not be read.")).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Finish", exact: true })).toBeEnabled();
});

test("existing profile names appear across identity screens and profile editing", async ({
  page,
}, info) => {
  await mockPublicProfile(page, {
    ...PROFILE,
    image: `pubky://${PROFILE_KEY}/pub/pubky.app/files/AVATAR`,
  });
  await seedProfileIdentity(page, false);
  await expect(page.getByRole("heading", { name: "Satoshi", exact: true })).toBeVisible();
  await expect(page.locator('main img[src^="blob:"]')).toBeVisible();
  expect(
    await page
      .locator('main img[src^="blob:"]')
      .evaluate((image: HTMLImageElement) => image.naturalWidth),
  ).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Switch identity" }).click();
  await expect(page.getByRole("button", { name: /Satoshi/ })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Satoshi");
  await page.screenshot({ path: info.outputPath("profile-existing.png"), fullPage: true });
});

test("profile form stays accessible in narrow and short windows with five links", async ({
  page,
}, info) => {
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page);
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await page
    .getByLabel("Name", { exact: true })
    .fill("A very long identity name that fits the profile");
  for (let index = 0; index < 3; index++)
    await page.getByRole("button", { name: "Add link" }).click();
  const footer = page.locator("footer");
  for (const viewport of [
    { width: 375, height: 667 },
    { width: 520, height: 760 },
    { width: 940, height: 600 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const mainBox = await page.locator("main").boundingBox();
    const footerBox = await footer.boundingBox();
    expect(footerBox!.y).toBeGreaterThanOrEqual(mainBox!.y + mainBox!.height - 1);
    await page.screenshot({
      path: info.outputPath(`profile-${viewport.width}.png`),
      fullPage: true,
    });
  }
});
