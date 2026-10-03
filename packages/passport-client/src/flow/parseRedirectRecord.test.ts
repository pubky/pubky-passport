// @vitest-environment node
import { expect, test } from "vitest";
import { parseRedirectRecord } from "./parseRedirectRecord.js";

const CANARY = ["saved", "private", "sdk", "state"].join("-");
const CLIENT = JSON.stringify([
  "Client",
  "",
  "client.example",
  "https://passport.example",
  "required",
]);
function record() {
  return {
    v: 1,
    attemptId: "abcdefghijklmnopqrstuv",
    client: CLIENT,
    state: CANARY,
    instance: "https://passport.example",
    createdAt: 1_800_000_000_000,
  };
}
const parse = (value: unknown) => parseRedirectRecord(JSON.stringify(value));

test("copies and freezes a record while keeping the SDK state opaque", () => {
  const input = { ...record(), state: '{"opaque":"' + CANARY + '","unknown":[1,2]}' };
  const result = parse(input);
  expect(result).toEqual(input);
  expect(Object.isFrozen(result)).toBe(true);
  expect(result!.state).toBe(input.state);
});

test.each(Object.keys(record()))("requires the %s field", (key) => {
  const input: Record<string, unknown> = record();
  delete input[key];
  expect(parse(input)).toBeUndefined();
});

test.each([
  null,
  [],
  "record",
  false,
  1,
  { extra: "unrecognized" },
  // Fields of the earlier shape: a record from before is discarded, not resumed.
  { kind: "delegated" },
  { returnPath: "/" },
  { v: 2 },
  { v: "1" },
  { attemptId: "" },
  { attemptId: "a".repeat(21) },
  { attemptId: "a".repeat(23) },
  { attemptId: "é".repeat(22) },
  { attemptId: "/".repeat(22) },
  { attemptId: 1 },
  { state: "" },
  { state: null },
  { state: {} },
  { createdAt: null },
  { createdAt: "1800000000000" },
  { instance: null },
  { instance: [] },
  { instance: { origin: "https://passport.example" } },
  { client: null },
  { client: 1 },
])("rejects malformed record %# without returning saved state", (change) => {
  const input =
    change && typeof change === "object" && !Array.isArray(change)
      ? { ...record(), ...change }
      : change;
  expect(parse(input)).toBeUndefined();
});

test.each(["1e400", "-1e400", "-1", "1.5", "9007199254740992"])(
  "rejects raw JSON timestamp %s without returning saved state",
  (timestamp) => {
    const raw = JSON.stringify({ ...record(), createdAt: "TIMESTAMP" }).replace(
      '"TIMESTAMP"',
      timestamp,
    );
    expect(parseRedirectRecord(raw)).toBeUndefined();
  },
);
test.each([0, 1, Number.MAX_SAFE_INTEGER])(
  "accepts safe timestamp %s structurally without deciding its age",
  (createdAt) => {
    expect(parse({ ...record(), createdAt })).toHaveProperty("createdAt", createdAt);
  },
);

test.each(["", "{", "null", "[", "undefined", '{"__proto__":{"polluted":true}}'])(
  "malformed serialized input %# returns no exception or raw data",
  (raw) => {
    expect(parseRedirectRecord(raw)).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  },
);

test("leaves ownership and the Passport origin to the store", () => {
  // Structure only: another client's fingerprint and any origin string parse; the store decides.
  const foreign = { ...record(), client: "another client", instance: "not an origin" };
  expect(parse(foreign)).toEqual(foreign);
});
