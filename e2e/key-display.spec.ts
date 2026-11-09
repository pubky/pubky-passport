import { E2E_SIGNUP_HOMESERVER } from "./helpers/e2eServer";
import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "./helpers/passportTest";
import { PROFILE_KEY, mockHomeserverRecords, seedProfileIdentity } from "./helpers/pubkyProfile";

/**
 * How a key's two text nodes lay out: each half on one line, and the second either on the same
 * line (the key fits) or on the next. Never a line with only a few characters.
 */
async function keyLines(key: Locator) {
  return key.evaluate((element) => {
    const halves = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE);
    const tops = halves.map((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].map((rect) => Math.round(rect.top));
    });
    const range = document.createRange();
    range.selectNodeContents(element);
    return {
      halves: halves.map((node) => node.textContent?.length),
      linesPerHalf: tops.map((rects) => new Set(rects).size),
      sameLine: tops[0]?.[0] === tops[1]?.[0],
      copied: range.toString(),
    };
  });
}

async function expectBalanced(page: Page, key: Locator, value: string, name: string) {
  await expect(key).toHaveText(value);
  const lines = await keyLines(key);
  expect(lines.halves).toEqual([26, 26]);
  expect(lines.linesPerHalf).toEqual([1, 1]);
  expect(lines.copied).toBe(value);
  for (const width of [320, 360, 412, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const at = await keyLines(key);
    expect(at.linesPerHalf, `${name} at ${width}px`).toEqual([1, 1]);
  }
  return lines;
}

test("the invite step's homeserver key is one line where it fits, else two equal halves", async ({
  page,
}, info) => {
  await mockHomeserverRecords(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Manage your own keys" }).click();
  await page.getByRole("button", { name: "Invite code", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Use invite." })).toBeVisible();
  const key = page.locator("#invite-homeserver");
  const viewport = page.viewportSize()!;
  await page.screenshot({ path: info.outputPath("invite-homeserver.png"), fullPage: true });
  await expectBalanced(page, key, E2E_SIGNUP_HOMESERVER, "invite homeserver");
  for (const width of [320, 412]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: info.outputPath(`invite-homeserver-${width}.png`) });
  }
  // On a phone the key takes two equal lines; on a desktop it fits on one.
  await page.setViewportSize({ width: 360, height: 900 });
  expect((await keyLines(key)).sameLine).toBe(false);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await keyLines(key)).sameLine).toBe(true);
  await page.setViewportSize(viewport);
});

test("the identity overview's pubky never leaves a few characters on a line", async ({ page }) => {
  await seedProfileIdentity(page, false);
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  const key = page.getByRole("region", { name: "Selected identity" }).getByText(PROFILE_KEY);
  await expectBalanced(page, key, PROFILE_KEY, "overview pubky");
});
