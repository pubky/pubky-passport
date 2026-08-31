import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

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

async function measureAccountRow(accountRow: Locator) {
  return accountRow.evaluate((row) => {
    const icon = row.querySelector("svg");
    const email = Array.from(row.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    if (!icon || !email) throw new Error("The Google account row is missing its expected content");

    const rowBox = row.getBoundingClientRect();
    const iconBox = icon.getBoundingClientRect();
    const emailRange = document.createRange();
    emailRange.selectNodeContents(email);
    const emailBox = emailRange.getBoundingClientRect();
    const contentLeft = Math.min(iconBox.left, emailBox.left);
    const contentRight = Math.max(iconBox.right, emailBox.right);

    return {
      row: { x: rowBox.x, y: rowBox.y, width: rowBox.width, height: rowBox.height },
      rowCenter: rowBox.left + rowBox.width / 2,
      contentLeft,
      contentCenter: (contentLeft + contentRight) / 2,
    };
  });
}

function expectWithinOnePixel(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
}

test("primary screens have no automated accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Quick & easy signing." })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.goto("/authorize");
  await expect(page.getByRole("heading", { name: "Authorize a service." })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the sign-in title keeps its designed line break and accent color", async ({ page }) => {
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
    expect(accentBox?.display).toBe("block");
    expect(accentBox?.color).toBe("rgb(200, 255, 0)");
    expect(accentBox?.top).toBeGreaterThan(titleBox?.top ?? 0);
    expect(Math.abs((accentBox?.left ?? 0) - (titleBox?.left ?? 0))).toBeLessThanOrEqual(1);
  }
});

test("the passport chrome does not overlap content in a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 400 });
  await page.goto("/");

  const logo = page.getByRole("img", { name: "Pubky Passport" });
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
  await page.goto("/authorize");

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
  await page.goto("/authorize");
  await page.getByRole("button", { name: /^Scan (?:authorization QR code|QR)$/ }).click();

  const dialog = page.getByRole("dialog", { name: "Scan QR code" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("Camera access is unavailable");
  expect(
    (await new AxeBuilder({ page }).include("dialog").disableRules("video-caption").analyze())
      .violations,
  ).toEqual([]);
});

test("identity selection synchronizes across tabs", async ({ context, page }) => {
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
  await expect(page.getByRole("heading", { name: "First" })).toBeVisible();

  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await otherTab.evaluate(
    ({ storageRoot, secondKey }) => localStorage.setItem(`${storageRoot}/active`, secondKey),
    { storageRoot: STORAGE_ROOT, secondKey: SECOND_KEY },
  );

  await expect(page.getByRole("heading", { name: "Second" })).toBeVisible();
  await otherTab.close();
});

test("the signed-in Google account row stays centered on mobile and left-aligned on desktop", async ({
  page,
}) => {
  await seedLocalIdentity(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const accountRow = page.getByText("First@example.com", { exact: true });
  await expect(accountRow).toBeVisible();
  await page.evaluate(async () => document.fonts.ready);

  const mobile = await measureAccountRow(accountRow);
  expectWithinOnePixel(mobile.row.x, 48);
  expectWithinOnePixel(mobile.row.y, 424);
  expectWithinOnePixel(mobile.row.width, 279);
  expectWithinOnePixel(mobile.row.height, 40);
  expectWithinOnePixel(mobile.contentCenter, mobile.rowCenter);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(async () => document.fonts.ready);

  const desktop = await measureAccountRow(accountRow);
  expectWithinOnePixel(desktop.row.width, 276);
  expectWithinOnePixel(desktop.contentLeft, desktop.row.x);
  expect(desktop.contentCenter).toBeLessThan(desktop.rowCenter);
});

test("backup password guidance enforces the six-character minimum responsively", async ({
  page,
}) => {
  await seedLocalIdentity(page);

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Manage" }).click();
    await page.getByRole("button", { name: "Download backup" }).click();

    const password = page.getByLabel("Enter strong password");
    const requirement = page.getByText("Minimum 6 characters.");
    const download = page.getByRole("button", { name: "Download backup" });
    await expect(password).toHaveAttribute("minlength", "6");
    await expect(password).toHaveAttribute(
      "aria-describedby",
      "recovery-file-password-requirement",
    );
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

    await password.fill("12345");
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(requirement).toHaveAttribute("role", "alert");
    await expect(download).toBeDisabled();

    await password.fill("123456");
    await expect(password).not.toHaveAttribute("aria-invalid", "true");
    await expect(requirement).not.toHaveAttribute("role", "alert");
    await expect(download).toBeEnabled();
  }
});

test("identity management keeps Log out in the designed responsive header position", async ({
  page,
}) => {
  await seedLocalIdentity(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "Manage" }).click();
  await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();
  await page.evaluate(async () => document.fonts.ready);

  const logout = page.getByRole("button", { name: "Log out" });
  const mobile = await logout.boundingBox();
  expect(mobile).not.toBeNull();
  expectWithinOnePixel(mobile?.x ?? 0, 257);
  expectWithinOnePixel(mobile?.y ?? 0, 26);
  expectWithinOnePixel(mobile?.width ?? 0, 94);
  expectWithinOnePixel(mobile?.height ?? 0, 32);

  await page.setViewportSize({ width: 1280, height: 720 });
  const desktop = await logout.boundingBox();
  expect(desktop).not.toBeNull();
  expectWithinOnePixel(desktop?.x ?? 0, 1135);
  expectWithinOnePixel(desktop?.y ?? 0, 48);
  expectWithinOnePixel(desktop?.width ?? 0, 105);
  expectWithinOnePixel(desktop?.height ?? 0, 40);
});

test("copying the Pubky shows the iconless brand toast at the mobile inset", async ({ page }) => {
  await seedLocalIdentity(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => undefined },
    });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "Manage" }).click();
  await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();

  await page.getByRole("button", { name: "Copy Pubky" }).click();
  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Pubky copied to clipboard" });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-mounted", "true");
  await expect(toast.locator("[data-title]")).toHaveText("Pubky copied to clipboard");
  await expect(toast.locator("[data-description]")).toHaveText(`${FIRST_KEY.slice(0, 32)}...`);
  await expect(toast.locator("[data-icon]")).toHaveCount(0);

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
