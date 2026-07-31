import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import {
  getValidatedAuthorizationCallbacks,
  isPubkyAuthApprovalCapability,
  parseBrowserAuthorizationRequest,
} from "./browserAuthorizationRequest";

const REQUEST =
  "pubkyauth://signin?caps=/pub/pubky.app/:rw,/:r&relay=https://relay.example/inbox&secret=test-secret&x-success=https://pubky.app/success?token=private&x-error=https://pubky.app/error&x-cancel=https://pubky.app/cancel";

describe("parseBrowserAuthorizationRequest", () => {
  it("creates an immutable safe review and parser-validated approval capability", () => {
    const parsed = parseBrowserAuthorizationRequest(encodeURIComponent(REQUEST));
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    expect(parsed.value.review).toEqual({
      kind: "signin",
      capabilities: [
        { path: "/pub/pubky.app/", read: true, write: true, scope: "specific" },
        { path: "/", read: true, write: false, scope: "broad" },
      ],
      callbackAvailability: { success: true, error: true, cancel: true },
      relayHost: "relay.example",
      requestingAppDisplayHost: "pubky.app",
    });
    expect(JSON.stringify(parsed.value.review)).not.toContain("test-secret");
    expect(JSON.stringify(parsed.value.review)).not.toContain("token=private");
    expect(JSON.stringify(parsed.value.review)).not.toContain("/inbox");
    expect(isPubkyAuthApprovalCapability(parsed.value.approval)).toBe(true);
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.review)).toBe(true);
    expect(Object.isFrozen(parsed.value.review.capabilities)).toBe(true);
    expect(parsed.value.review.capabilities.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(parsed.value.review.callbackAvailability)).toBe(true);
    expect(Object.isFrozen(parsed.value.approval)).toBe(true);
  });

  it("returns callbacks only for the exact validated approval object", () => {
    const parsed = parseBrowserAuthorizationRequest(encodeURIComponent(REQUEST));
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    expect(getValidatedAuthorizationCallbacks(parsed.value.approval)).toEqual({
      success: "https://pubky.app/success?token=private",
      error: "https://pubky.app/error",
      cancel: "https://pubky.app/cancel",
    });
    expect(getValidatedAuthorizationCallbacks({ ...parsed.value.approval })).toBeUndefined();
    expect(isPubkyAuthApprovalCapability({ ...parsed.value.approval })).toBe(false);
  });

  it("derives display hosts from fallback callbacks and preserves punycode", () => {
    const errorOnly = parseBrowserAuthorizationRequest(encodeURIComponent(
      "pubkyauth://signin?caps=/pub/app/:r&relay=https://relay.example/inbox&secret=secret&x-error=https://errors.example/error",
    ));
    if (Result.isError(errorOnly)) throw new Error(errorOnly.error.code);
    expect(errorOnly.value.review.requestingAppDisplayHost).toBe("errors.example");

    const internationalized = parseBrowserAuthorizationRequest(encodeURIComponent(
      "pubkyauth://signin?caps=/pub/app/:r&relay=https://relay.example/inbox&secret=secret&x-success=https://\u0430pple.example/success",
    ));
    if (Result.isError(internationalized)) throw new Error(internationalized.error.code);
    expect(internationalized.value.review.requestingAppDisplayHost).toBe("xn--pple-43d.example");
    expect(internationalized.value.review.requestingAppDisplayHost).not.toContain("\u0430");
  });

  it("omits browser-only callback display data when callbacks are absent", () => {
    const parsed = parseBrowserAuthorizationRequest(encodeURIComponent(
      "pubkyauth://signin?caps=/pub/app/:r&relay=https://relay.example/inbox&secret=secret",
    ));
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    expect(parsed.value.review.callbackAvailability).toEqual({ success: false, error: false, cancel: false });
    expect(parsed.value.review.requestingAppDisplayHost).toBeUndefined();
  });
});
