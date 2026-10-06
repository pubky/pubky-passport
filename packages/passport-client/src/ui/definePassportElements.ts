import { PassportButtonElement } from "./PassportButtonElement.js";

/** Idempotent and SSR-safe. */
export function definePassportElements(): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get("pubky-passport"))
    customElements.define("pubky-passport", PassportButtonElement);
}
