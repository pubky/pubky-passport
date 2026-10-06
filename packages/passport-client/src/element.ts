import { definePassportElements } from "./ui/definePassportElements.js";
import type { PassportButtonElement, PassportSessionEvent } from "./ui/PassportButtonElement.js";

// Types shared with the headless API (SignedIn, PassportProfile, …) come from the main entry.
export type { PassportButtonElement as PassportElement } from "./ui/PassportButtonElement.js";
export type { PassportSessionEvent } from "./ui/PassportButtonElement.js";

declare global {
  interface HTMLElementTagNameMap {
    "pubky-passport": PassportButtonElement;
  }
  interface HTMLElementEventMap {
    "passport-session": PassportSessionEvent;
  }
}

// Importing this module defines <pubky-passport>.
definePassportElements();
