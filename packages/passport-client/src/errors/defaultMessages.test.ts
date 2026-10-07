import { expect, test } from "vitest";
import { DEFAULT_MESSAGES } from "./defaultMessages.js";
import type { MessageKey } from "./messageTypes.js";

test.each([
  [
    "error.request_rejected.history_unavailable",
    "Passport couldn't open this request safely in this browser. Try again, or use another browser.",
  ],
  ["action.sign-in", "Continue with Pubky"],
  ["action.focus", "Show Passport window"],
  ["action.reopen", "Reopen"],
  ["action.cancel", "Cancel"],
  ["action.retry", "Try again"],
  ["action.use-default-instance", "Use {defaultHost}"],
  ["action.reset-instance", "Reset"],
  ["action.create-profile", "Finish your profile"],
  ["ring.divider", "or scan with Pubky Ring or Bitkit"],
  ["ring.divider.classic", "or scan with Pubky Ring"],
  ["ring.preparing", "Preparing QR code…"],
  ["ring.open", "Open keychain app"],
  ["ring.qr-label", "QR code to sign in with Pubky Ring or Bitkit"],
  ["ring.copy", "Copy authentication link"],
  ["ring.copied", "Link copied"],
  ["ring.copy-failed", "Could not copy"],
  ["ring.expired", "Click to reload"],
  ["ring.reload", "Reload QR code"],
  ["ring.classic", "Older Pubky Ring? Classic QR"],
  ["picker.toggle", "Use a different Passport"],
  ["picker.input", "Passport address"],
  ["picker.confirm", "Sign-ins from this app will open {instanceHost}"],
  ["picker.use", "Use this Passport"],
  ["picker.reset", "Reset to {defaultHost}"],
  ["return.stray", "Sign-in continues where you started it. You can close this tab."],
] satisfies [MessageKey, string][])("keeps the default copy for %s", (key, text) => {
  expect(DEFAULT_MESSAGES[key]).toBe(text);
});

test("default messages are immutable and have no signed-in label", () => {
  expect(Object.isFrozen(DEFAULT_MESSAGES)).toBe(true);
  expect(DEFAULT_MESSAGES).not.toHaveProperty("label.signed-in");
});
