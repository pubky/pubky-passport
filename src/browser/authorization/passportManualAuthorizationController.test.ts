import { describe, expect, it, vi } from "vitest";

import { PassportManualAuthorizationController } from "./passportManualAuthorizationController";

describe("PassportManualAuthorizationController", () => {
  it("rejects an invalid request without navigating", () => {
    const navigate = vi.fn();
    const controller = new PassportManualAuthorizationController(navigate);

    expect(controller.enter("pubkyauth://signin?secret=sensitive-secret")).toBe("invalid");
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
