// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  APPROVAL_CODES,
  REQUEST_CODES,
  isPassportMessage,
  parsePassportMessage,
} from "./passportMessages.js";

const ATTEMPT = "abcdefghijklmnopqrstuv";
const CANARY = ["private", "message", "payload"].join("_");
const ready = () => ({
  type: "pubky-passport.ready",
  version: 2,
  attemptId: ATTEMPT,
  protocols: [1, 2],
  features: ["outcome-v2", "status"],
  request: { status: "valid" },
});
const outcome = (version = 2) => ({
  type: "pubky-passport.authorization-outcome",
  version,
  ...(version === 2 ? { attemptId: ATTEMPT } : {}),
  messageId: "message",
  outcome: "success",
});
const vectors: { name: string; input: unknown; valid: boolean }[] = JSON.parse(
  readFileSync(new URL("../../test-vectors/opener-features.json", import.meta.url), "utf8"),
);

test.each(vectors)("shares Passport's feature policy: $name", ({ input, valid }) => {
  expect(parsePassportMessage({ ...ready(), features: input }) !== undefined).toBe(valid);
});
test.each(["valid", "invalid", "empty", "expired", "completed"])(
  "accepts ready request %s without inventing an outcome",
  (status) => {
    const input = { ...ready(), request: { status } };
    expect(parsePassportMessage(input)).toEqual(input);
  },
);
test.each(["ring", "granting"])("accepts the defined %s status", (phase) => {
  const input = { type: "pubky-passport.status", version: 2, attemptId: ATTEMPT, phase };
  expect(parsePassportMessage(input)).toEqual(input);
});
test.each([{ phase: "completed" }, { request: { status: "completed" } }])(
  "rejects completion on status without a valid phase: %j",
  (fields) => {
    expect(
      parsePassportMessage({
        type: "pubky-passport.status",
        version: 2,
        attemptId: ATTEMPT,
        ...fields,
      }),
    ).toBeUndefined();
  },
);
test.each(["ring", "granting"])("status %s ignores an unknown completion field", (phase) => {
  const status = { type: "pubky-passport.status", version: 2, attemptId: ATTEMPT, phase };
  expect(
    parsePassportMessage({ ...status, request: { status: "completed", secret: CANARY } }),
  ).toEqual(status);
});
test.each([1, 2])("accepts all v%s outcomes and bounded IDs", (version) => {
  for (const value of ["success", "error", "cancel"]) {
    for (const messageId of ["x", "x".repeat(128)]) {
      const input = { ...outcome(version), outcome: value, messageId };
      expect(parsePassportMessage(input)).toEqual(input);
    }
  }
});
test.each(REQUEST_CODES)("keeps known request code %s", (code) => {
  expect(parsePassportMessage({ ...ready(), request: { status: "invalid", code } })).toMatchObject({
    request: { status: "invalid", code },
  });
});
test.each(APPROVAL_CODES)("keeps known approval code %s for errors only", (code) => {
  expect(parsePassportMessage({ ...outcome(), outcome: "error", code })).toMatchObject({ code });
  expect(parsePassportMessage({ ...outcome(), code })).not.toHaveProperty("code");
});
test("tolerates unknown fields and bounded codes while copying no raw message references", () => {
  const input = {
    ...ready(),
    extra: CANARY,
    request: { status: "invalid", code: CANARY, secret: CANARY },
  };
  const parsed = parsePassportMessage(input);
  expect(parsed).toEqual({ ...ready(), request: { status: "invalid" } });
  expect(parsed).not.toBe(input);
  expect(JSON.stringify(parsed)).not.toContain(CANARY);
  expect(parsePassportMessage({ ...outcome(), outcome: "error", code: CANARY })).not.toHaveProperty(
    "code",
  );
  expect(
    parsePassportMessage({ ...ready(), request: { status: "valid", code: "history_unavailable" } }),
  ).not.toHaveProperty("request.code");
  expect(
    parsePassportMessage({ ...ready(), request: { status: "invalid", code: "empty" } }),
  ).not.toHaveProperty("request.code");
});
test.each([
  null,
  [],
  "message",
  2,
  true,
  { ...ready(), version: 1 },
  { ...ready(), version: 3 },
  { ...ready(), version: "2" },
  { ...ready(), attemptId: "x".repeat(15) },
  { ...ready(), attemptId: "x".repeat(65) },
  { ...ready(), attemptId: "space is not valid" },
  { ...ready(), protocols: [2, 1] },
  { ...ready(), protocols: [2] },
  { ...ready(), protocols: "1,2" },
  { ...ready(), request: null },
  { ...ready(), request: [] },
  { ...ready(), request: { status: "future" } },
  { ...ready(), request: { status: "invalid", code: "A" } },
  { ...ready(), request: { status: "invalid", code: "x".repeat(65) } },
  { ...ready(), request: { status: "invalid", code: "bad code" } },
  { ...ready(), request: { status: "invalid", code: 42 } },
  { ...outcome(), messageId: "" },
  { ...outcome(), messageId: "x".repeat(129) },
  { ...outcome(), messageId: 1 },
  { ...outcome(), outcome: "approved" },
  { ...outcome(), code: null },
  { type: "pubky-passport.status", version: 1, attemptId: ATTEMPT, phase: "ring" },
  { type: "pubky-passport.status", version: 2, attemptId: ATTEMPT, phase: "future" },
  { type: "pubky-passport.unknown", version: 2 },
])("rejects a malformed message %# without throwing", (input) => {
  expect(parsePassportMessage(input)).toBeUndefined();
});
test("copies and freezes known nested data while tolerating null-prototype plain objects", () => {
  const input = Object.assign(Object.create(null), ready());
  const parsed = parsePassportMessage(input)!;
  input.features[0] = CANARY;
  input.request.status = "empty";
  input.protocols[0] = 8;
  expect(parsed).toEqual(ready());
  expect(Object.isFrozen(parsed)).toBe(true);
  if (parsed.type === "pubky-passport.ready") {
    expect(Object.isFrozen(parsed.request)).toBe(true);
    expect(Object.isFrozen(parsed.features)).toBe(true);
    expect(Object.isFrozen(parsed.protocols)).toBe(true);
  }
  expect(
    parsePassportMessage(Object.assign(Object.create({ inherited: true }), ready())),
  ).toBeUndefined();
});
test("hostile getters, proxies, sparse arrays and replaced iterators cannot bypass validation", () => {
  const trap = () => {
    throw new Error(CANARY);
  };
  for (const property of ["type", "version", "attemptId", "protocols", "features", "request"]) {
    const input = Object.defineProperty(ready(), property, { get: trap });
    expect(parsePassportMessage(input)).toBeUndefined();
  }
  expect(parsePassportMessage(new Proxy({}, { getPrototypeOf: trap }))).toBeUndefined();
  expect(parsePassportMessage({ ...ready(), features: Array(1) })).toBeUndefined();
  const features = ["bad feature"];
  features[Symbol.iterator] = () => ["status"][Symbol.iterator]();
  expect(parsePassportMessage({ ...ready(), features })).toBeUndefined();
  let calls = 0;
  const input = Object.defineProperty(ready(), "attemptId", {
    get: () => (++calls === 1 ? ATTEMPT : CANARY),
  });
  expect(parsePassportMessage(input)).toHaveProperty("attemptId", ATTEMPT);
  expect(calls).toBe(1);
});
test("recognizes the protocol prefix without retaining or throwing on unrelated input", () => {
  expect(isPassportMessage(ready())).toBe(true);
  expect(isPassportMessage({ type: "pubky-passport.future" })).toBe(true);
  expect(isPassportMessage(Object.assign([], { type: "pubky-passport.ready" }))).toBe(true);
  for (const input of [
    null,
    {},
    [],
    { type: 2 },
    { type: "other.message" },
    new Proxy(
      {},
      {
        get() {
          throw new Error(CANARY);
        },
      },
    ),
  ])
    expect(isPassportMessage(input)).toBe(false);
});

test("validates and copies one feature count even when a Proxy changes its length", () => {
  let reads = 0;
  const features = new Proxy(Array<string>(17).fill("status"), {
    get(target, key, receiver) {
      return key === "length" ? (++reads === 1 ? 16 : 17) : Reflect.get(target, key, receiver);
    },
  });
  const parsed = parsePassportMessage({ ...ready(), features });
  expect(parsed).toHaveProperty("features", Array<string>(16).fill("status"));
  expect(reads).toBe(1);
});
test.each([-1, NaN, Infinity, 17])("rejects a hostile feature count %s", (length) => {
  const features = new Proxy([], { get: () => length });
  expect(parsePassportMessage({ ...ready(), features })).toBeUndefined();
});
