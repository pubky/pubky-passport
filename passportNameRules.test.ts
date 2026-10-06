import { expect, test } from "vitest";
import { UNSAFE_SOURCE_CHARACTERS } from "./src/client/logic/authorization/request/parser/pubkyAuthRequestParser";
import { UNSAFE_NAME } from "./packages/passport-client/src/config/appNameRules";

test("package app-name characters stay aligned with Passport source characters", () => {
  expect(UNSAFE_NAME.source).toBe(UNSAFE_SOURCE_CHARACTERS.source);
  expect(UNSAFE_NAME.flags).toBe(UNSAFE_SOURCE_CHARACTERS.flags);
});
