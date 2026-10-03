// @vitest-environment node
import { expect, it } from "vitest";
import { approvalFailureReason } from "./approvalFailureReason";

it.each([
  ["storage_unavailable", "storage_unavailable"],
  ["invalid_identity", "identity_unavailable"],
  ["invalid_secret_key", "identity_unavailable"],
  ["invalid_store", "identity_unavailable"],
  ["identity_mismatch", "identity_unavailable"],
  ["restore_failed", "identity_unavailable"],
  ["external_key", "identity_unavailable"],
] as const)("maps identity restore %s to %s", (code, expected) => {
  expect(approvalFailureReason("identity_restore", { code })).toBe(expected);
});

it.each([
  ["key_unavailable", "identity_unavailable"],
  ["approval_failed", "approval_failed"],
  ["request_rejected", "approval_failed"],
] as const)("maps SDK approval %s to %s", (code, expected) => {
  expect(approvalFailureReason("sdk_approve", { code })).toBe(expected);
});

it("recognizes RequestError only for an expected SDK approval failure", () => {
  const cause = { name: "RequestError", message: "secret-" + "canary" };
  expect(approvalFailureReason("sdk_approve", { code: "approval_failed", cause })).toBe(
    "relay_unreachable",
  );
  expect(approvalFailureReason("sdk_approve", { code: "request_rejected", cause })).toBe(
    "approval_failed",
  );
  expect(approvalFailureReason("identity_restore", { code: "restore_failed", cause })).toBe(
    "identity_unavailable",
  );
});

it("requires an owned stage and that stage's code at compile time", () => {
  // @ts-expect-error Initialization errors have their own boundary.
  expect(approvalFailureReason("sdk_initialize", { code: "approval_failed" })).toBe(
    "approval_failed",
  );
  // @ts-expect-error Storage codes belong to identity restore, not SDK approval.
  expect(approvalFailureReason("sdk_approve", { code: "storage_unavailable" })).toBe(
    "approval_failed",
  );
  // @ts-expect-error SDK approval codes cannot be passed to identity restore.
  expect(approvalFailureReason("identity_restore", { code: "key_unavailable" })).toBe(
    "approval_failed",
  );
});

it.each([
  undefined,
  null,
  "RequestError",
  { name: "Error" },
  { name: "OtherError" },
  { name: 1 },
  {
    get name() {
      throw new Error("secret getter");
    },
  },
])("never exposes unknown or throwing cause names: %#", (cause) => {
  expect(approvalFailureReason("sdk_approve", { code: "approval_failed", cause })).toBe(
    "approval_failed",
  );
});

it("contains a throwing cause accessor without exposing it", () => {
  expect(
    approvalFailureReason("sdk_approve", {
      code: "approval_failed",
      get cause() {
        throw new Error("private cause");
      },
    }),
  ).toBe("approval_failed");
});
