import { expect, expectTypeOf, test } from "vitest";
import { requestDigest as passportDigest } from "./src/libs/requestDigest";
import { requestDigest as clientDigest } from "./packages/passport-client/src/shared/requestDigest";
import type { AuthorizationEntryCode } from "./src/client/logic/authorization/entry/authorizationEntry";
import type { OpenerApprovalFailureReason } from "./src/client/logic/authorization/opener/OpenerChannel";
import {
  REQUEST_CODES,
  APPROVAL_CODES,
} from "./packages/passport-client/src/protocol/passportMessages";

test("client known-code lists cover exactly Passport's entry and approval code unions", () => {
  expectTypeOf<(typeof REQUEST_CODES)[number]>().toEqualTypeOf<AuthorizationEntryCode>();
  expectTypeOf<(typeof APPROVAL_CODES)[number]>().toEqualTypeOf<OpenerApprovalFailureReason>();
});

test("Passport and the client digest a request identically", () => {
  for (const url of [
    "",
    "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=x",
    "é".repeat(40) + "a".repeat(57),
  ])
    expect(passportDigest(url)).toBe(clientDigest(url));
});
