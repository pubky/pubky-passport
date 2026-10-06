// @vitest-environment node
import { expect, test } from "vitest";
import { authorizeUrl } from "./authorizeUrl.js";

const REQUEST = "pubkyauth://signin?caps=/pub/a/:rw&relay=https://relay.example/inbox&secret=x";

test("carries the request only in the fragment, with the profile and a testnet next to it", () => {
  const encoded = encodeURIComponent(REQUEST);
  expect(authorizeUrl("https://passport.example", REQUEST)).toBe(
    `https://passport.example/authorize#d=${encoded}`,
  );
  expect(authorizeUrl("https://passport.example", REQUEST, true)).toBe(
    `https://passport.example/authorize#d=${encoded}&profile=required`,
  );
  expect(authorizeUrl("https://passport.example", REQUEST, true, "testnet")).toBe(
    `https://passport.example/authorize#d=${encoded}&profile=required&network=testnet`,
  );
  // Mainnet adds nothing, so a Passport without network support still accepts the link.
  expect(authorizeUrl("https://passport.example", REQUEST, false, "mainnet")).toBe(
    `https://passport.example/authorize#d=${encoded}`,
  );
});
