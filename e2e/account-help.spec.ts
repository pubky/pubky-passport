import { expect, test } from "@playwright/test";

import { APPLE_PORT } from "../playwright.config";
import { installFakeApple } from "./support/fakeApple";

const ORIGIN = `http://127.0.0.1:${APPLE_PORT}`;

for (const viewport of [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
  { width: 320, height: 480 },
]) {
  test(`Figma drawer geometry, focus, actions and scrolling at ${viewport.width}x${viewport.height}`, async ({
    context,
    page,
  }) => {
    await installFakeApple(context);
    await page.setViewportSize(viewport);
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(() => document.fonts.ready);
    for (const provider of ["Google", "Apple"]) {
      const auth = page.getByRole("button", { name: `Continue with ${provider}`, exact: true });
      const help = page.getByRole("button", { name: `How ${provider} sign-in works` });
      const logo = await auth.locator("img").boundingBox();
      const label = await auth.locator("span").first().boundingBox();
      const icon = await help.locator("img").boundingBox();
      const target = await help.boundingBox();
      const pill = await auth.boundingBox();
      expect(logo?.width).toBe(16);
      expect(logo?.height).toBe(16);
      expect(label!.x - (logo!.x + logo!.width)).toBeCloseTo(8, 1);
      expect(icon!.x - (label!.x + label!.width)).toBeCloseTo(8, 1);
      expect(Math.round(target!.width)).toBeGreaterThanOrEqual(44);
      expect(Math.round(target!.height)).toBeGreaterThanOrEqual(44);
      expect(target!.x).toBeGreaterThanOrEqual(label!.x + label!.width - 0.1);
      expect((logo!.x + icon!.x + icon!.width) / 2).toBeCloseTo(pill!.x + pill!.width / 2, 1);
      await help.focus();
      await page.keyboard.press("Enter");
      const drawer = page.getByRole("dialog");
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("heading")).toBeFocused();
      await expect(drawer.locator("p > strong")).toHaveCount(4);
      await expect(drawer.locator("p")).toHaveText([
        "Your provider: Your account provider helps you sign in and find your encrypted backup. It does not create or control your pubky.",
        "Your keys: Your keys are created in your browser and encrypted before they are saved in your cloud storage.",
        "Recovery: When you sign in, Passport retrieves your encrypted backup and the separate key needed to unlock it.",
        "Split security: Your encrypted backup and the key that unlocks it are stored separately.",
      ]);
      const geometry = await drawer.evaluate((node) => {
        const style = getComputedStyle(node);
        const body = node.querySelector("p")!.parentElement!;
        const bodyStyle = getComputedStyle(body);
        return {
          width: node.clientWidth,
          maxHeight: node.clientHeight <= innerHeight,
          overflow: node.scrollWidth <= node.clientWidth,
          bodyPadding: bodyStyle.paddingLeft,
          fontSize: bodyStyle.fontSize,
          lineHeight: bodyStyle.lineHeight,
          weight: bodyStyle.fontWeight,
          background: style.backgroundColor,
        };
      });
      expect(geometry).toEqual({
        width: Math.min(viewport.width, 375),
        maxHeight: true,
        overflow: true,
        bodyPadding: "48px",
        fontSize: "14px",
        lineHeight: "20px",
        weight: "500",
        background: "rgb(29, 29, 32)",
      });
      const box = await drawer.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
      if (viewport.width < 768) expect(box!.y + box!.height).toBeCloseTo(viewport.height, 1);
      const continueAction = drawer.getByRole("button", { name: `Continue with ${provider}` });
      await continueAction.scrollIntoViewIfNeeded();
      expect((await continueAction.boundingBox())!.height).toBe(60);
      await drawer.getByRole("button", { name: "Learn more" }).click();
      await expect(drawer.getByRole("heading", { name: "How Passport works" })).toBeFocused();
      await expect(drawer).toContainText("On a new device");
      expect((await drawer.locator("p").allTextContents()).join(" ")).not.toMatch(
        /Apple|Google|iCloud|Drive/u,
      );
      await drawer.getByRole("button", { name: "Back to overview" }).click();
      await expect(drawer.getByRole("heading")).toBeFocused();
      // Native modal focus stays inside, including at the ends of its tab order.
      await drawer.getByRole("button", { name: "Learn more" }).focus();
      await page.keyboard.press("Tab");
      await expect(drawer.getByRole("button", { name: "Close" })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(drawer.getByRole("button", { name: "Learn more" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(help).toBeFocused();
      await help.click();
      await drawer.locator("header").click();
      await expect(drawer).toBeVisible();
      await page.mouse.click(2, 2);
      await expect(drawer).toBeHidden();
      await expect(help).toBeFocused();
      await help.click();
      await drawer.getByRole("button", { name: "Close" }).click();
      await expect(drawer).toBeHidden();
      await expect(help).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    expect(context.pages()).toHaveLength(1);
  });
}

test("Apple help Continue preserves the trusted click that opens the existing sign-in popup", async ({
  context,
  page,
}) => {
  await installFakeApple(context, { holdApple: true });
  await page.goto(`${ORIGIN}/`);
  await page.getByRole("button", { name: "How Apple sign-in works" }).click();
  const drawer = page.getByRole("dialog");
  const popupEvent = page.waitForEvent("popup");
  await drawer.getByRole("button", { name: "Continue with Apple" }).click();
  const popup = await popupEvent;
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("heading", { name: "Signing in with Apple." })).toBeVisible();
  await popup.close();
});

test("Google help Continue uses the same popup path as the pill", async ({ context, page }) => {
  await context.route("https://accounts.google.com/o/oauth2/v2/auth**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><h1>Google sign-in fixture</h1>",
    }),
  );
  await page.goto(`${ORIGIN}/`);
  await page.getByRole("button", { name: "How Google sign-in works" }).click();
  const drawer = page.getByRole("dialog");
  const popupEvent = page.waitForEvent("popup");
  await drawer.getByRole("button", { name: "Continue with Google" }).click();
  const popup = await popupEvent;
  await expect(drawer).toBeHidden();
  await expect(popup).toHaveURL(/^https:\/\/accounts\.google\.com\//u);
  await popup.close();
});
