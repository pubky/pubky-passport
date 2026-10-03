import type { BrowserContext, Page } from "@playwright/test";

/**
 * Makes the page report a coarse pointer, as a phone or tablet does, in every browser: Pubky Ring
 * hand-offs then lead with their deep link instead of the QR code a computer gets.
 */
export async function emulateCoarsePointer(page: Page): Promise<void> {
  await page.addInitScript(coarsePointer);
}

/** The same for every page the context opens from now on, such as an app's Passport popup. */
export async function emulateCoarsePointerInContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(coarsePointer);
}

/** Patches `matchMedia` only: CSS `@media (pointer: coarse)` rules are not affected. */
function coarsePointer(): void {
  const matchMedia = window.matchMedia.bind(window);
  window.matchMedia = (query: string) => {
    const coarse = /\(\s*pointer\s*:\s*coarse\s*\)/u.test(query);
    if (!coarse && !/\(\s*pointer\s*:\s*fine\s*\)/u.test(query)) return matchMedia(query);
    return {
      matches: coarse,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } as MediaQueryList;
  };
}
