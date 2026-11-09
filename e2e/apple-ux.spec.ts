import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { APPLE_PORT } from "../playwright.config";
import { installFakeApple } from "./support/fakeApple";
import { APPLE_BADGE, badgeOffset, expectOneBadge, GOOGLE_BADGE } from "./support/providerBadges";

const ORIGIN = `http://127.0.0.1:${APPLE_PORT}`;
test.use({ baseURL: ORIGIN });

async function screenshot(page: Page, info: TestInfo, name: string, width: number) {
  const directory =
    process.env.UX_SCREENSHOT_DIR && info.project.name === "chromium"
      ? process.env.UX_SCREENSHOT_DIR
      : info.outputPath("ux");
  await mkdir(directory, { recursive: true });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({
    path: join(directory, `${width}-${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

for (const width of [375, 390, 1280]) {
  test(`provider layout and separate keyboard help at ${width}`, async ({
    context,
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
    await installFakeApple(context);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Quick access." })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const google = page.getByRole("button", { name: "Continue with Google", exact: true });
    const apple = page.getByRole("button", { name: "Continue with Apple", exact: true });
    const g = await google.boundingBox();
    const a = await apple.boundingBox();
    expect(g!.height).toBe(60);
    expect(a!.height).toBe(60);
    expect(a!.y - g!.y - g!.height).toBe(12);
    if (width === 375) expect(a!.width).toBe(327);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await screenshot(page, info, "sign-in", width);
    for (const provider of ["Google", "Apple"]) {
      const help = page.getByRole("button", { name: `How ${provider} sign-in works` });
      const inside = await help.evaluate(
        (button) => button.parentElement?.closest("button") !== null,
      );
      expect(inside).toBe(false);
      await help.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: `How ${provider} sign-in works` });
      await expect(dialog).toBeVisible();
      if (provider === "Apple") await expect(dialog).toContainText("Step 2 of 2");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await dialog.click({ position: { x: 8, y: 8 } });
      await expect(dialog).toBeVisible();
      await screenshot(page, info, `${provider.toLowerCase()}-help`, width);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(help).toBeFocused();
    }
    expect(context.pages()).toHaveLength(1);
  });

  test(`Apple first-step cancellation and retry at ${width}`, async ({ context, page }, info) => {
    await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
    await installFakeApple(context, { holdApple: true });
    await page.goto("/");
    const popupEvent = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Continue with Apple", exact: true }).click();
    const popup = await popupEvent;
    await expect(page.getByRole("heading", { name: "Signing in with Apple." })).toBeVisible();
    await screenshot(page, info, "apple-step1", width);
    await page.getByRole("button", { name: "Bring back Apple’s window" }).click();
    const closed = popup.waitForEvent("close");
    await page.getByRole("button", { name: "Cancel and try again" }).click();
    await closed;
    await expect(page.getByRole("heading", { name: "Setup interrupted." })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with Apple", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Continue with Apple", exact: true }),
    ).toBeEnabled();
    await screenshot(page, info, "apple-step1-cancelled", width);
  });

  test(`iCloud fallback, waiting and closed-window recovery at ${width}`, async ({
    context,
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
    await installFakeApple(context, { closeAfterApple: true, holdICloud: true });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue with Apple", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Signed in with Apple. One more step." }),
    ).toBeVisible();
    await screenshot(page, info, "icloud-idle", width);
    const popupEvent = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Continue with Apple", exact: true }).click();
    const popup = await popupEvent;
    await expect(page.getByRole("heading", { name: "Finish in Apple's window." })).toBeVisible();
    await screenshot(page, info, "icloud-waiting", width);
    await popup.close();
    await page.getByRole("button", { name: "Bring back Apple’s window" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("window was closed");
    await expect(
      page.getByRole("button", { name: "Continue with Apple", exact: true }),
    ).toBeFocused();
    await screenshot(page, info, "icloud-closed", width);
    await expect(
      page.getByRole("button", { name: "Continue with Apple", exact: true }),
    ).toBeEnabled();
  });

  for (const [error, name, text] of [
    ["accessError", "web-access-off", "Web access to your iCloud data is turned off"],
    ["unknownError", "apple-error-or-terms-refused", "If you declined the iCloud terms"],
  ] as const) {
    test(`iCloud ${name} at ${width}`, async ({ context, page }, info) => {
      await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
      await installFakeApple(context, { icloudError: error });
      await page.goto("/");
      await page.getByRole("button", { name: "Continue with Apple", exact: true }).click();
      await expect(page.getByRole("main").getByRole("alert")).toContainText(text);
      if (error === "accessError")
        await expect(
          page.getByRole("link", { name: "How to allow web access to iCloud data" }),
        ).toHaveAttribute("href", "https://support.apple.com/kb/HT212523");
      await screenshot(page, info, `icloud-${name}`, width);
      await expect(
        page.getByRole("button", { name: "Continue with Apple", exact: true }),
      ).toBeEnabled();
    });
  }

  for (const failure of ["network", "unavailable", "blocked"] as const) {
    test(`iCloud ${failure} recovery at ${width}`, async ({ context, page }, info) => {
      await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
      await installFakeApple(context, { closeAfterApple: failure === "blocked" });
      if (failure !== "blocked")
        await context.route("https://api.apple-cloudkit.com/**", (route) =>
          failure === "network" ? route.abort("failed") : route.fulfill({ status: 503, json: {} }),
        );
      await page.goto("/");
      await page.getByRole("button", { name: "Continue with Apple", exact: true }).click();
      if (failure === "blocked") {
        await expect(
          page.getByRole("heading", { name: "Signed in with Apple. One more step." }),
        ).toBeVisible();
        await page.evaluate(() => {
          window.open = () => null;
        });
        await page.getByRole("button", { name: "Continue with Apple", exact: true }).click();
      }
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        failure === "network"
          ? "Check your connection"
          : failure === "blocked"
            ? "blocked the iCloud window"
            : "could not prepare",
      );
      await screenshot(page, info, `icloud-${failure}`, width);
      await expect(
        page.getByRole("button", { name: "Continue with Apple", exact: true }),
      ).toBeEnabled();
    });
  }

  test(`account switcher at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
    await page.addInitScript(() => {
      const root = "pubky-passport/local-identities/v1";
      const key = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
      localStorage.setItem(
        `${root}/identity/${key}`,
        JSON.stringify({
          v: 1,
          publicKeyZ32: key,
          appleAccount: {
            appleSubject: "sample-apple",
            name: "Jane Appleseed",
            email: "jane@example.com",
          },
          secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
        }),
      );
      const googleKey = "tkrq8zmwb8a3m9k15csu3q17qmfgqnp9dskbrg9uq1rydpyxp7qy";
      localStorage.setItem(
        `${root}/identity/${googleKey}`,
        JSON.stringify({
          v: 1,
          publicKeyZ32: googleKey,
          googleAccount: {
            googleSubject: "sample-google",
            email: "satoshi@gmail.com",
            name: "Satoshi Nakamoto",
            pictureUrl: null,
          },
          secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
        }),
      );
      localStorage.setItem(`${root}/active`, key);
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Switch", exact: true }).click();
    await expect(page.getByText("Apple Account", { exact: true })).toHaveCount(0);
    await expect(page.locator('img[src*="sign-in-with-apple"]')).toHaveCount(0);
    // The Apple badge sits on the avatar exactly where the Google G sits on its avatar.
    const appleRow = page.getByRole("button", { name: /Jane Appleseed/u });
    const googleRow = page.getByRole("button", { name: /Satoshi Nakamoto/u });
    const appleBadge = await expectOneBadge(appleRow, APPLE_BADGE);
    const googleBadge = await expectOneBadge(googleRow, GOOGLE_BADGE);
    expect(await badgeOffset(appleBadge, appleRow.locator("span.rounded-full").first())).toEqual(
      await badgeOffset(googleBadge, googleRow.locator("span.rounded-full").first()),
    );
    if (width < 500) {
      for (const text of ["Jane Appleseed", "jane@example.com"]) {
        expect(
          await page
            .getByRole("main")
            .getByText(text, { exact: true })
            .evaluate((node) => node.scrollWidth <= node.clientWidth),
        ).toBe(true);
      }
    }
    await screenshot(page, info, "switcher", width);
  });

  test(`overview with a long private relay email at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
    const email = "x7k2m9q4rtabcdefgh12345678@privaterelay.appleid.com";
    await page.addInitScript((relayEmail) => {
      const root = "pubky-passport/local-identities/v1";
      const key = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
      localStorage.setItem(
        `${root}/identity/${key}`,
        JSON.stringify({
          v: 1,
          publicKeyZ32: key,
          appleAccount: { appleSubject: "sample-apple", name: "Jane Appleseed", email: relayEmail },
          secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
        }),
      );
      localStorage.setItem(`${root}/active`, key);
    }, email);
    await page.goto("/");
    const badge = await expectOneBadge(page.getByRole("main"), APPLE_BADGE);
    const line = badge.locator("xpath=..");
    const text = line.getByText(email, { exact: true });
    // The badge keeps its size and the email truncates inside the line instead of overflowing it.
    expect(await line.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await text.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  });

  test(`iCloud timeout at ${width}`, async ({ context, page }, info) => {
    await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
    await installFakeApple(context, { holdICloud: true });
    await page.clock.install();
    await page.goto("/");
    await page.getByRole("button", { name: "Continue with Apple", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Finish in Apple's window." })).toBeVisible();
    await page.clock.runFor(5 * 60_000 + 500);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("took too long");
    await screenshot(page, info, "icloud-timeout", width);
  });
}
