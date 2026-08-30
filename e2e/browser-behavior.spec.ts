import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const FIRST_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECOND_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const SECRET_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const STORAGE_ROOT = "pubky-passport/local-identities/v1";

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
  await page.getByRole("button", { name: "Scan authorization QR code" }).click();

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
