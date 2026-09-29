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
  // Setup is asked for right after creation only; afterwards the overview offers it.
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await page.getByRole("button", { name: "Set up profile" }).click();
  await expect(page.getByRole("heading", { name: "Create your profile." })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("profile-empty.png"), fullPage: true });
  await expect(page.getByRole("heading", { name: "Create your profile." })).toBeFocused();
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
  // Back leaves setup for the overview, never for a backup detour.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose backup method" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeFocused();
  await page.getByRole("button", { name: "Set up profile" }).click();
  await page.getByLabel("Name", { exact: true }).fill(PROFILE.name);
  await page.getByLabel("Choose avatar file").setInputFiles("e2e/fixtures/profile-avatar.png");
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
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Set up profile" })).toBeVisible();
});

test("marks each invalid field where it is, with the limits shown before saving", async ({
  page,
}) => {
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page);
  // Setup is offered from the overview once the identity exists.
  await page.getByRole("button", { name: "Set up profile" }).click();
  const writes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "homeserver.example" && request.method() !== "GET")
      writes.push(`${request.method()} ${request.url()}`);
  });
  const name = page.getByLabel("Name", { exact: true });
  const bio = page.getByLabel("Bio", { exact: true });
  const website = page.getByLabel("Website", { exact: true });
  await expect(name).toHaveAccessibleDescription("3–50 characters. Shown publicly.");
  await expect(bio).toHaveAccessibleDescription("0 of 160 characters");
  // Enter submits from the invalid Name field itself, where focus already is, so the form's status
  // says why nothing was saved.
  const refusal = page.locator("form").getByRole("status");
  await name.fill("Al");
  await name.press("Enter");
  await expect(refusal).toHaveText(
    "1 field needs a change. Name: Enter a name of 3–50 characters.",
  );
  await expect(name).toBeFocused();
  await name.fill("");
  await bio.fill("b".repeat(161));
  await expect(page.getByText("161/160")).toBeVisible();
  await website.fill("my website");
  await page.getByRole("button", { name: "Add link" }).click();
  await page.getByLabel("Link 3 URL").fill("https://github.com/satoshi");

  // The popup: Finish sits far below the Name field it has to point back to.
  await page.setViewportSize({ width: 520, height: 760 });
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(name).toBeFocused();
  await expect(refusal).toHaveText("4 fields need changes. Name: Enter a name of 3–50 characters.");
  await expect(name).toBeInViewport({ ratio: 1 });
  await expect(
    page.getByText("Enter a name of 3–50 characters.", { exact: true }),
  ).toBeInViewport();
  // No browser bubble: the page's own message describes the field.
  expect(await name.evaluate((input: HTMLInputElement) => input.validationMessage)).toBe("");
  for (const [control, message] of [
    [name, "Enter a name of 3–50 characters."],
    [bio, "Keep your bio to 160 characters (you have 161)."],
    [website, "Enter a full web address, like https://example.com."],
    [page.getByLabel("Link 3 title"), "Give this link a title."],
  ] as const) {
    await expect(control).toHaveAttribute("aria-invalid", "true");
    await expect(control).toHaveAccessibleDescription(message);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await name.fill("Satoshi");
  await expect(name).not.toHaveAttribute("aria-invalid");
  await bio.fill("Bitcoin");
  await website.fill("https://bitcoin.org");
  await page.getByLabel("Link 3 title").fill("GitHub");
  expect(writes).toEqual([]);
  // Every field passes, so the save runs and meets the unavailable homeserver.
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Could not save your profile",
    { timeout: 15000 },
  );
  await expect(refusal).toBeEmpty();
});

test("an unreadable published profile opens an empty editor instead of blocking setup", async ({
  page,
}) => {
  await mockPublicProfile(page, { name: "x" });
  await seedProfileIdentity(page);
  await page.getByRole("button", { name: "Set up profile" }).click();
  await expect(page.getByRole("heading", { name: "Create your profile." })).toBeVisible();
  await expect(page.getByText("We couldn’t read your current profile.")).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
  // Saving replaces the profile other apps show, so the button says so.
  await expect(page.getByRole("button", { name: "Replace profile", exact: true })).toBeEnabled();
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
  await page.getByRole("button", { name: "Set up profile" }).click();
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

test("in the app's popup, a focused field scrolls clear of the actions pinned below it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 520, height: 760 });
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page);
  await page.getByRole("button", { name: "Set up profile" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  for (let index = 0; index < 3; index++)
    await page.getByRole("button", { name: "Add link" }).click();
  const lastLink = page.getByRole("textbox", { name: /^Link \d+ URL$/u }).last();
  const bar = page.locator("[data-sticky-actions]");

  // Park the field in the window but under the bar, where focusing it would otherwise leave it.
  await lastLink.evaluate((field) => {
    const box = field.getBoundingClientRect();
    window.scrollBy({ top: box.bottom - (window.innerHeight - 20), behavior: "instant" });
  });
  const barTop = (await bar.boundingBox())!.y;
  expect((await lastLink.boundingBox())!.y).toBeGreaterThan(barTop);
  await lastLink.focus();

  await expect(lastLink).toBeFocused();
  await expect
    .poll(async () => {
      const field = (await lastLink.locator("xpath=..").boundingBox())!;
      return field.y + field.height;
    })
    .toBeLessThanOrEqual((await bar.boundingBox())!.y);
});
