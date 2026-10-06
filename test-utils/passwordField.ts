import { expect } from "vitest";

/** A revealable password field: shown as text, nothing checks, corrects or capitalizes it. */
export function expectNoTextAssistance(field: HTMLElement): void {
  expect(field).toHaveAttribute("spellcheck", "false");
  expect(field).toHaveAttribute("autocorrect", "off");
  expect(field).toHaveAttribute("autocapitalize", "none");
}
