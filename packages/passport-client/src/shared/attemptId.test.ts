import { expect, test } from "vitest";
import { createAttemptId } from "./attemptId.js";
test("uses 16 random bytes for a unique unpadded base64url attempt ID", () => {
  const ids = Array.from({ length: 50 }, () => createAttemptId(crypto));
  for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/u);
  expect(new Set(ids).size).toBe(ids.length);
});
