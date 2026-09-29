import { expect, test } from "vitest";
import { mapSdkError } from "./mapSdkError.js";
test.each([
  ["RequestError", "start", "network"],
  ["RequestError", "poll", "network"],
  ["PkarrError", "poll", "identity_unresolved"],
  ["PkarrError", "start", "internal"],
  ["AuthenticationError", "poll", "approval_rejected"],
  ["AuthenticationError", "start", "internal"],
  ["InvalidInput", "start", "internal"],
  ["ClientStateError", "poll", "internal"],
  ["InternalError", "poll", "internal"],
  ["Error", "poll", "internal"],
] as const)("maps %s at %s without leaking SDK payload", (name, stage, code) => {
  const canary = "url-with-" + "sensitive-state";
  const raw = Object.assign(new Error(canary), {
    name,
    data: { statusCode: 503, savedState: canary },
  });
  const { error } = mapSdkError(raw, stage);
  expect(error.code).toBe(code);
  expect(error.cause?.message).toBe(name === "Error" ? "UnknownError" : name);
  for (const text of [
    String(error.cause),
    error.message,
    error.devMessage,
    error.stack,
    error.cause?.stack,
    JSON.stringify(error),
  ])
    expect(text).not.toContain(canary);
});
test.each([
  "null pointer passed to rust",
  "recursive use of an object detected which would lead to unsafe aliasing in rust",
  "object while it was borrowed",
])("turns disposed or borrowed handle failure into internal: %s", (message) => {
  expect(mapSdkError(new Error(message), "poll").error.code).toBe("internal");
});
test("reports a duplicated SDK constructor without exposing its error text", () => {
  const result = mapSdkError(new Error("expected instance of AuthFlowKind"), "start");
  expect(result.error.code).toBe("internal");
  expect(result.diagnostic).toBe("sdk_duplicate_suspected");
});
test.each([
  null,
  undefined,
  42,
  "canary",
  { name: "canary", data: { statusCode: "503" } },
  {
    get name() {
      throw new Error("canary");
    },
  },
])("handles untrusted error shapes", (raw) => {
  const result = mapSdkError(raw, "poll");
  expect(result.error.code).toBe("internal");
  expect(result.error.cause?.message).toBe("UnknownError");
  expect(result.error.detail).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("canary");
});
