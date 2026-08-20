import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { IssuedPubkyAuthRequest } from "./IssuedPubkyAuthRequest";

const REQUEST =
  "pubkyauth://signin?caps=/pub/pubky.app/:rw,/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://pubky.app/success?token=private&x-error=https://pubky.app/error&x-cancel=https://pubky.app/cancel";
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

describe("IssuedPubkyAuthRequest", () => {
  it("creates an immutable safe review and exact approval authority", () => {
    const issued = IssuedPubkyAuthRequest.issue(encodeURIComponent(REQUEST));
    if (Result.isError(issued)) throw new Error(issued.error.code);

    expect(issued.value.review).toEqual({
      authenticationMethod: "cookie",
      capabilities: [
        { path: "/pub/pubky.app/", read: true, write: true, scope: "specific" },
        { path: "/", read: true, write: false, scope: "broad" },
      ],
      callbackHost: "pubky.app",
    });
    expect(JSON.stringify(issued.value)).not.toContain("token=private");
    expect(JSON.stringify(issued.value)).not.toContain("/inbox");
    expect(IssuedPubkyAuthRequest.isLive(issued.value)).toBe(true);
    expect(Object.isFrozen(issued.value)).toBe(true);
    expect(Object.isFrozen(issued.value.review)).toBe(true);
    expect(Object.isFrozen(issued.value.review.capabilities)).toBe(true);
    expect(issued.value.review.capabilities.every(Object.isFrozen)).toBe(true);
    expect(IssuedPubkyAuthRequest.validatedUrlForApproval(issued.value)).toBe(REQUEST);
  });

  it("projects the v0.10 grant method without exposing proof parameters", () => {
    const grantRequest = REQUEST
      .replace("pubkyauth://signin", "pubkyauth://signin_grant")
      .replace(
        "&x-success=",
        "&cid=pubky.app&cpk=5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo&x-success=",
      );

    const issued = IssuedPubkyAuthRequest.issue(encodeURIComponent(grantRequest));

    if (Result.isError(issued)) throw new Error(issued.error.code);
    expect(issued.value.review.authenticationMethod).toBe("grant");
    expect(issued.value.review).not.toHaveProperty("clientId");
    expect(JSON.stringify(issued.value.review)).not.toContain("5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo");
  });

  it.each([
    ["success", "https://pubky.app/success?token=private"],
    ["error", "https://pubky.app/error"],
    ["cancel", "https://pubky.app/cancel"],
  ] as const)("takes only the validated %s callback and releases the request", (outcome, callback) => {
    const issued = IssuedPubkyAuthRequest.issue(encodeURIComponent(REQUEST));
    if (Result.isError(issued)) throw new Error(issued.error.code);

    expect(IssuedPubkyAuthRequest.takeOutcomeCallback(issued.value, outcome)).toBe(callback);
    expect(IssuedPubkyAuthRequest.isLive(issued.value)).toBe(false);
    expect(IssuedPubkyAuthRequest.validatedUrlForApproval(issued.value)).toBeUndefined();
  });

  it("rejects forged instances and releases private metadata explicitly", () => {
    const issued = IssuedPubkyAuthRequest.issue(encodeURIComponent(REQUEST));
    if (Result.isError(issued)) throw new Error(issued.error.code);
    const forged = Object.create(
      Object.getPrototypeOf(issued.value),
    ) as IssuedPubkyAuthRequest;

    expect(IssuedPubkyAuthRequest.isLive(forged)).toBe(false);
    expect(IssuedPubkyAuthRequest.validatedUrlForApproval(forged)).toBeUndefined();
    expect(IssuedPubkyAuthRequest.takeOutcomeCallback(forged, "success")).toBeUndefined();

    IssuedPubkyAuthRequest.release(issued.value);
    expect(IssuedPubkyAuthRequest.isLive(issued.value)).toBe(false);
  });

  it("derives display hosts from fallback callbacks and preserves punycode", () => {
    const errorOnly = IssuedPubkyAuthRequest.issue(encodeURIComponent(
      "pubkyauth://signin?caps=/pub/app/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-error=https://errors.example/error",
    ));
    if (Result.isError(errorOnly)) throw new Error(errorOnly.error.code);
    expect(errorOnly.value.review.callbackHost).toBe("errors.example");

    const internationalized = IssuedPubkyAuthRequest.issue(encodeURIComponent(
      "pubkyauth://signin?caps=/pub/app/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://\u0430pple.example/success",
    ));
    if (Result.isError(internationalized)) throw new Error(internationalized.error.code);
    expect(internationalized.value.review.callbackHost).toBe("xn--pple-43d.example");
    expect(internationalized.value.review.callbackHost).not.toContain("\u0430");
  });

  it("includes a non-default callback port in the callback host", () => {
    const issued = IssuedPubkyAuthRequest.issue(encodeURIComponent(
      "pubkyauth://signin?caps=/pub/app/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://app.example:8443/success",
    ));
    if (Result.isError(issued)) throw new Error(issued.error.code);

    expect(issued.value.review.callbackHost).toBe("app.example:8443");
  });

  it("warns only for namespace-wide capability paths", () => {
    const issued = IssuedPubkyAuthRequest.issue(encodeURIComponent(
      "pubkyauth://signin?caps=/:r,/pub:r,/pub/:r,/priv:r,/priv/:r,/priv/app/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8",
    ));
    if (Result.isError(issued)) throw new Error(issued.error.code);

    expect(issued.value.review.capabilities.map(({ path, scope }) => ({ path, scope }))).toEqual([
      { path: "/", scope: "broad" },
      { path: "/pub", scope: "specific" },
      { path: "/pub/", scope: "broad" },
      { path: "/priv", scope: "specific" },
      { path: "/priv/", scope: "broad" },
      { path: "/priv/app/", scope: "specific" },
    ]);
  });

  it("does not present the relay host as a callback host", () => {
    const issued = IssuedPubkyAuthRequest.issue(encodeURIComponent(
      "pubkyauth://signin?caps=/pub/app/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8",
    ));
    if (Result.isError(issued)) throw new Error(issued.error.code);

    expect(issued.value.review.callbackHost).toBeUndefined();
  });
});

describe("IssuedPubkyAuthRequest.validate", () => {
  it("returns only success without issuing a request", () => {
    const result = IssuedPubkyAuthRequest.validate(encodeURIComponent(REQUEST));

    expect(Result.isOk(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("returns only a safe error code for invalid input", () => {
    const result = IssuedPubkyAuthRequest.validate(encodeURIComponent(
      `pubkyauth://signin?secret=${SECRET}`,
    ));

    expect(Result.isError(result) && result.error).toEqual({ code: "missing_relay" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
