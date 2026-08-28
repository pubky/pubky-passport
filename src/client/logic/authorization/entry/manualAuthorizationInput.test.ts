import { describe, expect, it } from "vitest";

import { PUBKY_AUTH_REQUEST_LIMITS } from "../request/parser/pubkyAuthRequestParser";
import { validateManualAuthorizationInput } from "./manualAuthorizationInput";

describe("validateManualAuthorizationInput", () => {
  it("rejects an invalid request", () => {
    expect(validateManualAuthorizationInput("pubkyauth://signin?secret=sensitive-secret")).toEqual({
      status: "invalid",
    });
  });

  it("rejects malformed UTF-16 without throwing", () => {
    expect(validateManualAuthorizationInput("pubkyauth://signin?secret=\ud800")).toEqual({
      status: "invalid",
    });
  });

  it("rejects oversized input before encoding", () => {
    expect(
      validateManualAuthorizationInput(
        "a".repeat(PUBKY_AUTH_REQUEST_LIMITS.maximumDecodedAuthUrlCodeUnits + 1),
      ),
    ).toEqual({ status: "invalid" });
    expect(
      validateManualAuthorizationInput(
        `${" ".repeat(PUBKY_AUTH_REQUEST_LIMITS.maximumDecodedAuthUrlCodeUnits)}a`,
      ),
    ).toEqual({ status: "invalid" });
  });

  it("normalizes a valid request into an authorize entry destination", () => {
    const request =
      "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://example.app/success";
    const result = validateManualAuthorizationInput(`  ${request}  `);

    expect(result.status).toBe("valid");
    if (result.status !== "valid") throw new Error("Expected a valid destination");
    const parsed = new URL(result.destination, "https://passport.test");
    expect({
      pathname: parsed.pathname,
      queryKeys: [...parsed.searchParams.keys()].sort(),
      fragmentKeys: [...new URLSearchParams(parsed.hash.slice(1)).keys()].sort(),
      hasEncodedRequest: Boolean(new URLSearchParams(parsed.hash.slice(1)).get("d")),
    }).toEqual({
      pathname: "/authorize",
      queryKeys: [],
      fragmentKeys: ["d"],
      hasEncodedRequest: true,
    });
  });
});
