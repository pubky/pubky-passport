import { expect, test } from "vitest";
import { parseReturnMarker } from "./parseReturnMarker.js";

const ID = "aA0_-".repeat(4) + "bZ";
test.each(["s", "e", "c"] as const)("parses exactly the %s marker", (kind) => {
  expect(parseReturnMarker(`${kind}.${ID}`)).toEqual({ kind, attemptId: ID });
});
test.each([
  null,
  undefined,
  "",
  "s",
  `S.${ID}`,
  `x.${ID}`,
  `s:${ID}`,
  `s.${ID.slice(1)}`,
  `s.${ID}A`,
  `s.${ID}\n`,
  `s.${ID}\r`,
  `s.${ID}\u2028`,
  `s.${ID}\u2029`,
  `s.${ID.slice(0, -1)}!`,
  `s.${ID.slice(0, -1)}é`,
  `s.${ID.slice(0, -1)} `,
  ` s.${ID}`,
  `s.${ID} `,
  `s.${ID}?`,
  `s.${ID}#`,
  `s.${ID}&errorCode=x`,
])("ignores invalid return value %#", (value) => {
  expect(parseReturnMarker(value)).toBeUndefined();
});
