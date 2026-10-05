import { expect, it } from "vitest";

import { formatSats } from "./formatSats";

it.each([
  [10, "10"],
  [1_000, "1,000"],
  [21_000_000, "21,000,000"],
])("groups %i sats as %s", (amountSat, formatted) => {
  expect(formatSats(amountSat)).toBe(formatted);
});
