import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { parseSignupRequest } from "./signupRequest";

const state = "test_signup_state_1234";
const fragment = (callback = "https://app.example/return") =>
  `#${new URLSearchParams({ callback, state })}`;

describe("parseSignupRequest", () => {
  it("accepts a bounded HTTPS callback and correlation state", () => {
    expect(parseSignupRequest(fragment(), "")).toEqual(
      Result.ok({
        callback: "https://app.example/return",
        clientOrigin: "https://app.example",
        state,
      }),
    );
  });
  it("supports the standalone method picker without inventing a return destination", () => {
    expect(parseSignupRequest("", "")).toEqual(Result.ok(null));
  });
  it.each([
    "http://app.example/return",
    "javascript:alert(1)",
    "//app.example/return",
    "/return",
    "https://user:password@app.example/return",
    "https://app.example/return#secret=grant",
  ])("rejects unsafe callback %s", (callback) => {
    expect(Result.isError(parseSignupRequest(fragment(callback), ""))).toBe(true);
  });
  it.each([
    "#d=pubkyauth%3A%2F%2Fsignin_grant%3Fsecret%3Dgrant",
    `${fragment()}&secret=grant`,
    `${fragment()}&relay=https://relay.example`,
    `${fragment()}&callback=https://other.example`,
    `${fragment()}&state=another_state_1234`,
    "#callback=https://app.example",
    "#callback=https://app.example&state=short",
    "#" + "x".repeat(4096),
  ])("rejects grant data and malformed or ambiguous metadata", (hash) => {
    expect(Result.isError(parseSignupRequest(hash, ""))).toBe(true);
  });
  it("rejects query parameters", () => {
    expect(Result.isError(parseSignupRequest(fragment(), "?secret=grant"))).toBe(true);
  });
});
