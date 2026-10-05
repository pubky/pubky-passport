import { expect, test } from "vitest";
import { fitsPassportQr } from "./fitsPassportQr.js";

test.each([2330, 2331, 2332])("gates byte-mode payload at %s UTF-8 bytes", (size) => {
  const prefix = "pubkyauth://";
  const text = prefix + "a".repeat(size - prefix.length);
  expect(new TextEncoder().encode(text)).toHaveLength(size);
  expect(fitsPassportQr(text)).toBe(size <= 2331);
});
test("measures multibyte input by bytes rather than UTF-16 length", () => {
  expect(fitsPassportQr("é".repeat(1165) + "a")).toBe(true);
  expect(fitsPassportQr("é".repeat(1166))).toBe(false);
  expect(fitsPassportQr("😀".repeat(583))).toBe(false);
});
