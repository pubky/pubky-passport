import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import {
  getValidatedOutcomeCallback,
  getValidatedSensitivePubkyAuthUrl,
  isPubkyAuthApprovalCapability,
  issueAuthorizationRequest,
  releaseAuthorizationApproval,
} from "./issuedAuthorizationRequest";

const REQUEST =
  "pubkyauth://signin?caps=/pub/pubky.app/:rw,/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://pubky.app/success?token=private&x-error=https://pubky.app/error&x-cancel=https://pubky.app/cancel";

describe("issueAuthorizationRequest", () => {
  it("creates an immutable safe review and parser-validated approval capability", () => {
    const parsed = issueAuthorizationRequest(encodeURIComponent(REQUEST));
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    expect(parsed.value.review).toEqual({
      kind: "signin",
      authenticationMethod: "cookie",
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
    expect(Object.getOwnPropertyNames(parsed.value.approval)).toEqual([]);
    expect(JSON.stringify(parsed.value.approval)).toBe("{}");
    expect(getValidatedSensitivePubkyAuthUrl(parsed.value.approval)).toBe(REQUEST);
  });

  it("projects the v0.10 grant method without exposing proof parameters", () => {
    const grantRequest = REQUEST
      .replace("pubkyauth://signin", "pubkyauth://signin_grant")
      .replace(
        "&x-success=",
        "&cid=pubky.app&cpk=5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo&x-success=",
      );

    const parsed = issueAuthorizationRequest(encodeURIComponent(grantRequest));

    if (Result.isError(parsed)) throw new Error(parsed.error.code);
    expect(parsed.value.review.authenticationMethod).toBe("grant");
    expect(parsed.value.review).not.toHaveProperty("clientId");
    expect(JSON.stringify(parsed.value.review)).not.toContain("5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo");
  });

  it("returns callbacks only for the exact validated approval object", () => {
    const parsed = issueAuthorizationRequest(encodeURIComponent(REQUEST));
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    expect(getValidatedOutcomeCallback(parsed.value.approval, "success")).toBe(
      "https://pubky.app/success?token=private",
    );
    expect(getValidatedOutcomeCallback(parsed.value.approval, "error")).toBe("https://pubky.app/error");
    expect(getValidatedOutcomeCallback(parsed.value.approval, "cancel")).toBe("https://pubky.app/cancel");
    expect(getValidatedOutcomeCallback({ ...parsed.value.approval }, "success")).toBeUndefined();
    expect(getValidatedSensitivePubkyAuthUrl({ ...parsed.value.approval })).toBeUndefined();
    expect(isPubkyAuthApprovalCapability({ ...parsed.value.approval })).toBe(false);
  });

  it("releases private metadata after terminal handling", () => {
    const parsed = issueAuthorizationRequest(encodeURIComponent(REQUEST));
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    releaseAuthorizationApproval(parsed.value.approval);

    expect(isPubkyAuthApprovalCapability(parsed.value.approval)).toBe(false);
    expect(getValidatedOutcomeCallback(parsed.value.approval, "success")).toBeUndefined();
    expect(getValidatedSensitivePubkyAuthUrl(parsed.value.approval)).toBeUndefined();
  });

  it("derives display hosts from fallback callbacks and preserves punycode", () => {
    const errorOnly = issueAuthorizationRequest(encodeURIComponent(
      "pubkyauth://signin?caps=/pub/app/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-error=https://errors.example/error",
    ));
    if (Result.isError(errorOnly)) throw new Error(errorOnly.error.code);
    expect(errorOnly.value.review.requestingAppDisplayHost).toBe("errors.example");

    const internationalized = issueAuthorizationRequest(encodeURIComponent(
      "pubkyauth://signin?caps=/pub/app/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://\u0430pple.example/success",
    ));
    if (Result.isError(internationalized)) throw new Error(internationalized.error.code);
    expect(internationalized.value.review.requestingAppDisplayHost).toBe("xn--pple-43d.example");
    expect(internationalized.value.review.requestingAppDisplayHost).not.toContain("\u0430");
  });

  it("uses the validated relay host when callbacks are absent", () => {
    const parsed = issueAuthorizationRequest(encodeURIComponent(
      "pubkyauth://signin?caps=/pub/app/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8",
    ));
    if (Result.isError(parsed)) throw new Error(parsed.error.code);

    expect(parsed.value.review.callbackAvailability).toEqual({ success: false, error: false, cancel: false });
    expect(parsed.value.review.requestingAppDisplayHost).toBe("relay.example");
  });

});
