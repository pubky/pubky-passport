import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { requestDigest, sha256 } from "./requestDigest.js";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

test.each([
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  ],
])("matches the FIPS 180-4 vector for %j", (input, expected) => {
  expect(hex(sha256(input))).toBe(expected);
});

test.each([55, 56, 63, 64, 65, 119, 120, 2331].map((n) => "é".repeat(n / 2) + "a".repeat(n % 2)))(
  "agrees with Node for padding boundaries and multi-byte UTF-8 (%#)",
  (input) => {
    expect(requestDigest(input)).toBe(
      createHash("sha256").update(input, "utf8").digest("base64url"),
    );
  },
);

test("is unpadded base64url of 43 characters", () => {
  expect(requestDigest("pubkyauth://signin?secret=x")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
});
