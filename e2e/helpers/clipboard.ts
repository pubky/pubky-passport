import type { Page } from "@playwright/test";

/** Records what the page copies, in every browser, instead of asking for clipboard access. */
export async function recordClipboard(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const copied: string[] = [];
    Object.defineProperty(window, "__copied", { value: copied });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied.push(text);
          return Promise.resolve();
        },
      },
    });
  });
  return () => page.evaluate(() => (window as Window & { __copied?: string[] }).__copied ?? []);
}
