import { mockPublicProfile, seedProfileIdentity } from "./helpers/pubkyProfile";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./helpers/passportTest";

const FIRST_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECOND_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const SECRET_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const STORAGE_ROOT = "pubky-passport/local-identities/v1";

async function seedLocalIdentity(page: Page) {
  await page.addInitScript(
    ({ firstKey, secretKey, storageRoot }) => {
      localStorage.setItem(
        `${storageRoot}/identity/${firstKey}`,
        JSON.stringify({
          v: 1,
          publicKeyZ32: firstKey,
          secretKey,
          googleAccount: {
            googleSubject: "google-First",
            email: "First@example.com",
            name: "First",
            pictureUrl: null,
          },
        }),
      );
      localStorage.setItem(`${storageRoot}/active`, firstKey);
    },
    { firstKey: FIRST_KEY, secretKey: SECRET_KEY, storageRoot: STORAGE_ROOT },
  );
}

test("primary screens have no automated accessibility violations", async ({ page }) => {
  await seedLocalIdentity(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Authorize an app" }).click();
  await expect(page.getByRole("heading", { name: "Authorize a service." })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the signer title keeps its accent color without horizontal overflow", async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const heading = page.getByRole("heading", { name: "Quick & easy signing." });
    await expect(heading).toBeVisible();
    const headingColor = await heading.evaluate((element) => getComputedStyle(element).color);
    const [titleBox, accentBox] = await heading.locator("span").evaluateAll((spans) =>
      spans.map((span) => {
        const bounds = span.getBoundingClientRect();
        return {
          color: getComputedStyle(span).color,
          display: getComputedStyle(span).display,
          left: bounds.left,
          top: bounds.top,
        };
      }),
    );

    expect(titleBox).toBeDefined();
    expect(accentBox).toBeDefined();
    expect(titleBox?.color).toBe(headingColor);
    expect(accentBox?.color).toBe("rgb(200, 255, 0)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  }
});

test("the passport chrome does not overlap content in a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 400 });
  await page.goto("/");

  const logo = page.getByRole("img", { name: "Pubky", exact: true });
  const heading = page.getByRole("heading", { name: "Quick & easy signing." });
  const footer = page.locator("body > footer");
  const main = page.locator("main");
  await expect(heading).toBeVisible();

  const [logoBox, headingBox, mainBox, footerBox] = await Promise.all([
    logo.boundingBox(),
    heading.boundingBox(),
    main.boundingBox(),
    footer.boundingBox(),
  ]);

  expect(logoBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(mainBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect((logoBox?.y ?? 0) + (logoBox?.height ?? 0)).toBeLessThanOrEqual(headingBox?.y ?? 0);
  expect(await footer.evaluate((element) => getComputedStyle(element).position)).toBe("static");
  expect(footerBox?.y).toBeGreaterThanOrEqual((mainBox?.y ?? 0) + (mainBox?.height ?? 0) - 1);
});

test("brand border utilities override the neutral base border", async ({ page }) => {
  await seedLocalIdentity(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Authorize an app" }).click();

  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeVisible();
  expect(await continueButton.evaluate((element) => getComputedStyle(element).borderColor)).toBe(
    "rgb(200, 255, 0)",
  );
});

test("camera denial is contained in an accessible dialog", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(new DOMException("Mocked denial", "NotAllowedError")),
      },
    });
  });
  await seedLocalIdentity(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Authorize an app" }).click();
  await page.getByRole("button", { name: /^Scan (?:authorization QR code|QR)$/ }).click();

  const dialog = page.getByRole("dialog", { name: "Scan QR code" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("Camera access is unavailable");
  expect(
    (await new AxeBuilder({ page }).include("dialog").disableRules("video-caption").analyze())
      .violations,
  ).toEqual([]);
});

test("saved identities stay available when active identity changes across tabs", async ({
  context,
  page,
}) => {
  await page.addInitScript(
    ({ firstKey, secondKey, secretKey, storageRoot }) => {
      const profile = (publicKeyZ32: string, name: string) =>
        JSON.stringify({
          v: 1,
          publicKeyZ32,
          secretKey,
          googleAccount: {
            googleSubject: `google-${name}`,
            email: `${name}@example.com`,
            name,
            pictureUrl: null,
          },
        });
      localStorage.setItem(`${storageRoot}/identity/${firstKey}`, profile(firstKey, "First"));
      localStorage.setItem(`${storageRoot}/identity/${secondKey}`, profile(secondKey, "Second"));
      localStorage.setItem(`${storageRoot}/active`, firstKey);
    },
    {
      firstKey: FIRST_KEY,
      secondKey: SECOND_KEY,
      secretKey: SECRET_KEY,
      storageRoot: STORAGE_ROOT,
    },
  );
  await page.goto("/");
  // Without profile.json the Google name is not shown; the attached email identifies each one.
  await expect(page.getByText("First@example.com", { exact: true })).toBeVisible();
  await expect(page.getByText("Second@example.com", { exact: true })).toHaveCount(0);

  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await otherTab.evaluate(
    ({ storageRoot, secondKey }) => localStorage.setItem(`${storageRoot}/active`, secondKey),
    { storageRoot: STORAGE_ROOT, secondKey: SECOND_KEY },
  );

  await expect(page.getByText("Second@example.com", { exact: true })).toBeVisible();
  await otherTab.close();
});

test("saved identity rows do not overflow mobile or desktop", async ({ page }) => {
  await seedLocalIdentity(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  await page.getByRole("button", { name: "Manage identity" }).click();
  const accountRow = page.getByText("First@example.com", { exact: true });
  await expect(accountRow).toBeVisible();
  await page.evaluate(async () => document.fonts.ready);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(async () => document.fonts.ready);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
});

test("backup password guidance enforces the twelve-character minimum responsively", async ({
  page,
}) => {
  await seedLocalIdentity(page);

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Manage identity" }).click();
    await page.getByRole("button", { name: "Download backup" }).click();

    const password = page.getByLabel("Enter strong password");
    const requirement = page.getByText("Minimum 12 characters.");
    const download = page.getByRole("button", { name: "Download backup" });
    await expect(password).toHaveAttribute("minlength", "12");
    await expect(password).toHaveAttribute("aria-describedby", "backup-password-help");
    await expect(requirement).toBeVisible();

    const [passwordBox, requirementBox] = await Promise.all([
      password.boundingBox(),
      requirement.boundingBox(),
    ]);
    expect(passwordBox).not.toBeNull();
    expect(requirementBox).not.toBeNull();
    expect(requirementBox?.y).toBeGreaterThanOrEqual(
      (passwordBox?.y ?? 0) + (passwordBox?.height ?? 0),
    );

    await password.fill("12345678901");
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(requirement).toHaveAttribute("role", "alert");
    await expect(download).toBeDisabled();

    await password.fill("123456789012");
    await expect(password).not.toHaveAttribute("aria-invalid", "true");
    await expect(requirement).not.toHaveAttribute("role", "alert");
    await expect(download).toBeEnabled();
  }
});

test("overview keeps recovery and account actions in a separate management screen", async ({
  page,
}) => {
  await seedLocalIdentity(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Authorize an app" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download backup" })).toHaveCount(0);
  await page.getByRole("button", { name: "Manage identity" }).click();
  await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();
  await expect(page.locator("main")).toBeFocused();
  await expect(page.getByRole("button", { name: "Authorize an app" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download backup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use in Pubky Ring" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Detach from Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await expect(page.locator("main")).toBeFocused();
});

test("overview pubky is plain text; management copying shows the gray info toast", async ({
  page,
}) => {
  await seedLocalIdentity(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => undefined },
    });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();

  const pubky = page.getByText(FIRST_KEY, { exact: true });
  await expect(pubky).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy Pubky" })).toHaveCount(0);
  await expect(pubky).not.toHaveAttribute("title");
  await pubky.click();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Copy Pubky" }).click();
  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Pubky copied to clipboard" });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-mounted", "true");
  await expect(toast).toHaveAttribute("data-type", "info");
  await expect(toast.locator("[data-title]")).toHaveText("Pubky copied to clipboard");
  await expect(toast.locator("[data-description]")).toHaveText(`${FIRST_KEY.slice(0, 32)}...`);
  const icon = toast.locator("[data-icon] svg");
  await expect(icon).toHaveCount(1);
  await expect(icon).toHaveAttribute("viewBox", "0 0 20 20");

  await expect
    .poll(
      async () => {
        const box = await toast.boundingBox();
        return (
          box !== null &&
          Math.abs(box.x - 24) <= 1 &&
          Math.abs(box.y - 24) <= 1 &&
          Math.abs(box.width - 327) <= 1
        );
      },
      { timeout: 2_000 },
    )
    .toBe(true);
});

test("management copy controls align with their values and share a right edge", async ({
  page,
}, testInfo) => {
  await mockPublicProfile(page, { name: "Satoshi Nakamoto" });
  await seedProfileIdentity(page, false);
  await page.getByRole("button", { name: "Manage identity" }).click();
  await expect(page.getByRole("button", { name: "Copy Homeserver" })).toBeEnabled();
  await page.evaluate(async () => document.fonts.ready);

  for (const width of [1440, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const controls = [];
    for (const name of ["Copy Pubky", "Copy Homeserver"]) {
      const button = page.getByRole("button", { name });
      const geometry = await button.evaluate((element) => {
        const control = element.getBoundingClientRect();
        const value = element.parentElement!.querySelector("p")!.getBoundingClientRect();
        const icon = element.querySelector("img, svg")!.getBoundingClientRect();
        return {
          right: control.right,
          width: control.width,
          height: control.height,
          iconWidth: icon.width,
          iconHeight: icon.height,
          centerOffset: control.y + control.height / 2 - (value.y + value.height / 2),
          gap: control.left - value.right,
        };
      });
      expect(geometry.width).toBe(36);
      expect(geometry.height).toBe(36);
      expect(geometry.iconWidth).toBe(20);
      expect(geometry.iconHeight).toBe(20);
      expect(Math.abs(geometry.centerOffset)).toBeLessThanOrEqual(1);
      expect(geometry.gap).toBe(12);
      controls.push(geometry);
    }
    expect(controls[0]!.right).toBe(controls[1]!.right);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.getByRole("region", { name: "Public profile" }).screenshot({
      path: testInfo.outputPath(`profile-copy-controls-${width}.png`),
    });
  }
});

test("management backup uses one encryption password and verifies the downloaded file", async ({
  page,
}, testInfo) => {
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page, false);
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Download backup" }).click();
  await page.getByLabel("Enter strong password").fill("correct horse");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup" }).click();
  const backup = await downloadPromise;
  await expect(page.getByRole("heading", { name: "Verify backup." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip verification" })).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("management-backup-verification.png"),
    fullPage: true,
  });
  await page.getByLabel("Backup just downloaded").setInputFiles((await backup.path())!);
  await page.getByLabel("Backup password").fill("wrong password");
  await page.getByRole("button", { name: "Verify backup" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("password is wrong");
  await page.getByLabel("Backup password").fill("correct horse");
  await page.getByRole("button", { name: "Verify backup" }).click();
  await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();
});
