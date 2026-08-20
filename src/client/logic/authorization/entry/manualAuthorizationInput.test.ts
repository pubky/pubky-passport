import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../../../libs/logger/logger";
import { PUBKY_AUTH_REQUEST_LIMITS } from "../request/pubkyAuthRequestLimits";
import { submitManualAuthorizationInput } from "./manualAuthorizationInput";

describe("submitManualAuthorizationInput", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects an invalid request without navigating", () => {
    const navigate = sanitizedNavigationRecorder();

    expect(submitManualAuthorizationInput("pubkyauth://signin?secret=sensitive-secret", navigate.navigate)).toBe("invalid");
    expect(navigate.calls).toBe(0);
  });

  it("rejects malformed UTF-16 without throwing or navigating", () => {
    const navigate = sanitizedNavigationRecorder();

    expect(submitManualAuthorizationInput("pubkyauth://signin?secret=\ud800", navigate.navigate)).toBe("invalid");
    expect(navigate.calls).toBe(0);
  });

  it("rejects oversized input before encoding or navigating", () => {
    const navigate = sanitizedNavigationRecorder();

    expect(submitManualAuthorizationInput("a".repeat(PUBKY_AUTH_REQUEST_LIMITS.decodedAuthUrlLength + 1), navigate.navigate)).toBe("invalid");
    expect(submitManualAuthorizationInput(`${" ".repeat(PUBKY_AUTH_REQUEST_LIMITS.decodedAuthUrlLength)}a`, navigate.navigate)).toBe("invalid");
    expect(navigate.calls).toBe(0);
  });

  it("normalizes and routes a valid request through the authorize entry point", () => {
    const navigate = sanitizedNavigationRecorder();
    const request = "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://example.app/success";

    expect(submitManualAuthorizationInput(`  ${request}  `, navigate.navigate)).toBe("navigating");
    expect(navigate.record).toEqual({ pathname: "/authorize", queryKeys: [], fragmentKeys: ["d"], hasEncodedRequest: true });
    expect(JSON.stringify(navigate)).not.toContain("secret");
  });

  it("logs navigation failures without exposing the authorization request", () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    const request = "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

    expect(submitManualAuthorizationInput(request, () => { throw new Error("secret-canary"); })).toBe("navigation_failed");

    expect(info).toHaveBeenCalledWith("authorize.manual_entry.failed", {
      operation: "enter_authorization",
      code: "navigation_failed",
    });
    expect(info).toHaveBeenCalledOnce();
    expect(JSON.stringify(info.mock.calls)).not.toContain("secret-canary");
  });

});

function sanitizedNavigationRecorder() {
  const recorder = {
    calls: 0,
    record: null as null | { pathname: string; queryKeys: string[]; fragmentKeys: string[]; hasEncodedRequest: boolean },
    navigate(value: string) {
      const parsed = new URL(value, "https://passport.test");
      recorder.calls += 1;
      recorder.record = {
        pathname: parsed.pathname,
        queryKeys: [...parsed.searchParams.keys()].sort(),
        fragmentKeys: [...new URLSearchParams(parsed.hash.slice(1)).keys()].sort(),
        hasEncodedRequest: Boolean(new URLSearchParams(parsed.hash.slice(1)).get("d")),
      };
    },
  };
  return recorder;
}
