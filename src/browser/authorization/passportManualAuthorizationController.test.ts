import { describe, expect, it, vi } from "vitest";

import { PUBKY_AUTH_REQUEST_LIMITS } from "../../core/auth/pubkyAuthRequestLimits";
import { PassportManualAuthorizationController } from "./passportManualAuthorizationController";

describe("PassportManualAuthorizationController", () => {
  it("rejects an invalid request without navigating", () => {
    const navigate = vi.fn();
    const controller = new PassportManualAuthorizationController(navigate);

    expect(controller.enter("pubkyauth://signin?secret=sensitive-secret")).toBe("invalid");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("rejects malformed UTF-16 without throwing or navigating", () => {
    const navigate = vi.fn();
    const controller = new PassportManualAuthorizationController(navigate);

    expect(controller.enter("pubkyauth://signin?secret=\ud800")).toBe("invalid");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("rejects oversized input before encoding or navigating", () => {
    const navigate = vi.fn();
    const controller = new PassportManualAuthorizationController(navigate);

    expect(controller.enter("a".repeat(PUBKY_AUTH_REQUEST_LIMITS.decodedAuthUrlLength + 1))).toBe("invalid");
    expect(controller.enter(`${" ".repeat(PUBKY_AUTH_REQUEST_LIMITS.decodedAuthUrlLength)}a`)).toBe("invalid");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("normalizes and routes a valid request through the authorize entry point", () => {
    const navigate = vi.fn();
    const controller = new PassportManualAuthorizationController(navigate);
    const request = "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=secret&x-success=https://example.app/success";

    expect(controller.enter(`  ${request}  `)).toBe("navigating");
    expect(navigate).toHaveBeenCalledWith(`/authorize?d=${encodeURIComponent(request)}`);
  });
});
