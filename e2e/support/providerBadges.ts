import { expect, type Locator } from "@playwright/test";

/** The small Apple badge on an Apple identity, the counterpart of the Google "G" badge. */
export const APPLE_BADGE = 'svg[viewBox="4.558 13.4 15 15"]';
/** The small Google "G" badge on a Google identity (other 16px icons share its viewBox). */
export const GOOGLE_BADGE = 'svg[viewBox="0 0 16 16"]:has(path[fill="#4285F4" i])';

/** Exactly one badge in the scope, visible, drawn at 16 by 16 CSS pixels. Returns it. */
export async function expectOneBadge(scope: Locator, selector: string): Promise<Locator> {
  const badge = scope.locator(selector);
  await expect(badge).toHaveCount(1);
  await expect(badge).toBeVisible();
  const box = await badge.boundingBox();
  expect(box?.width).toBe(16);
  expect(box?.height).toBe(16);
  return badge;
}

/** Where a badge sits relative to a box, such as the avatar it marks. */
export async function badgeOffset(badge: Locator, anchor: Locator) {
  const [badgeBox, anchorBox] = await Promise.all([badge.boundingBox(), anchor.boundingBox()]);
  if (!badgeBox || !anchorBox) throw new Error("badge or anchor is not laid out");
  return {
    right: anchorBox.x + anchorBox.width - (badgeBox.x + badgeBox.width),
    bottom: anchorBox.y + anchorBox.height - (badgeBox.y + badgeBox.height),
  };
}
