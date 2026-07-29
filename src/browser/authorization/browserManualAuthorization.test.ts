import { describe, expect, it } from "vitest";

import { PUBKY_AUTH_REQUEST_LIMITS } from "../../core/auth/pubkyAuthRequestLimits";
import { enterAuthorization } from "./browserManualAuthorization";

describe("enterAuthorization", () => {
  it("rejects an invalid request without navigating", () => {
    const navigate = sanitizedNavigationRecorder();

    expect(enterAuthorization("pubkyauth://signin?secret=sensitive-secret", navigate.navigate)).toBe("invalid");
    expect(navigate.calls).toBe(0);
  });

  it("rejects malformed UTF-16 without throwing or navigating", () => {
    const navigate = sanitizedNavigationRecorder();

    expect(enterAuthorization("pubkyauth://signin?secret=\ud800", navigate.navigate)).toBe("invalid");
    expect(navigate.calls).toBe(0);
  });

  it("rejects oversized input before encoding or navigating", () => {
    const navigate = sanitizedNavigationRecorder();

    expect(enterAuthorization("a".repeat(PUBKY_AUTH_REQUEST_LIMITS.decodedAuthUrlLength + 1), navigate.navigate)).toBe("invalid");
    expect(enterAuthorization(`${" ".repeat(PUBKY_AUTH_REQUEST_LIMITS.decodedAuthUrlLength)}a`, navigate.navigate)).toBe("invalid");
    expect(navigate.calls).toBe(0);
  });

  it("normalizes and routes a valid request through the authorize entry point", () => {
    const navigate = sanitizedNavigationRecorder();
    const request = "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=secret&x-success=https://example.app/success";

    expect(enterAuthorization(`  ${request}  `, navigate.navigate)).toBe("navigating");
    expect(navigate.record).toEqual({ pathname: "/authorize", queryKeys: ["d"], hasEncodedRequest: true });
    expect(JSON.stringify(navigate)).not.toContain("secret");
  });
});

function sanitizedNavigationRecorder() {
  const recorder = {
    calls: 0,
    record: null as null | { pathname: string; queryKeys: string[]; hasEncodedRequest: boolean },
    navigate(value: string) {
      const parsed = new URL(value, "https://passport.test");
      recorder.calls += 1;
      recorder.record = {
        pathname: parsed.pathname,
        queryKeys: [...parsed.searchParams.keys()].sort(),
        hasEncodedRequest: Boolean(parsed.searchParams.get("d")),
      };
    },
  };
  return recorder;
}
