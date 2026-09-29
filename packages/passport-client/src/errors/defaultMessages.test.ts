import { expect, test } from "vitest";
import { DEFAULT_MESSAGES } from "./defaultMessages.js";
import type { MessageKey } from "./messageTypes.js";

test.each([
  ["action.sign-in", "Sign in with Passport"],
  ["action.focus", "Show Passport window"],
  ["action.reopen", "Reopen"],
  ["action.cancel", "Cancel"],
  ["action.continue-in-tab", "Continue in this tab"],
  ["action.retry", "Try again"],
  ["action.use-default-instance", "Use {defaultHost}"],
  ["action.reset-instance", "Reset"],
  ["action.create-profile", "Create your Pubky profile"],
  ["ring.divider", "or scan with Pubky Ring"],
  ["ring.preparing", "Preparing QR code…"],
  ["ring.qr-caption", "Scan with Pubky Ring"],
  ["ring.qr-caption.during-attempt", "Or approve with Pubky Ring"],
  ["ring.open", "Open in Pubky Ring"],
  ["ring.show-qr", "Show QR code"],
  ["ring.qr-label", "QR code to sign in with Pubky Ring"],
  ["picker.toggle", "Use a different Passport"],
  ["picker.input", "Passport address"],
  ["picker.continue", "Continue"],
  ["picker.confirm", "Sign-ins from this app will open {instanceHost}"],
  ["picker.use", "Use this Passport"],
  ["picker.cancel", "Cancel"],
  ["picker.reset", "Reset to {defaultHost}"],
  ["return.stray", "Sign-in continues where you started it. You can close this tab."],
] satisfies [MessageKey, string][])("keeps the default copy for %s", (key, text) => {
  expect(DEFAULT_MESSAGES[key]).toBe(text);
});

test("default messages are immutable and have no signed-in label", () => {
  expect(Object.isFrozen(DEFAULT_MESSAGES)).toBe(true);
  expect(DEFAULT_MESSAGES).not.toHaveProperty("label.signed-in");
});
