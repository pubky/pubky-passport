import { expect, test } from "vitest";

import { DEFAULT_PASSPORT_INSTANCE } from "./index.js";

test("uses the public Passport instance by default", () => {
  expect(DEFAULT_PASSPORT_INSTANCE).toBe("https://passport.pubky.app");
});
