import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "@/libs/logger/logger";
import { capabilityReach, ValidatedPubkyAuthRequest } from "./ValidatedPubkyAuthRequest";

const REQUEST =
  "pubkyauth://signin?caps=/pub/pubky.app/:rw,/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-source=Pubky%20App&x-success=https://pubky.app/success?token=private&x-error=https://pubky.app/error&x-cancel=https://pubky.app/cancel";
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

describe("ValidatedPubkyAuthRequest", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates an immutable safe review and exact approval authority", () => {
    const validated = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(REQUEST));
    if (Result.isError(validated)) throw new Error(validated.error.code);

    expect(validated.value.review).toEqual({
      authenticationMethod: "cookie",
      capabilities: [
        { path: "/pub/pubky.app/", read: true, write: true, scope: "specific" },
        { path: "/", read: true, write: false, scope: "broad" },
      ],
      requesterName: "Pubky App",
      callbackHost: "pubky.app",
    });
    expect(JSON.stringify(validated.value)).not.toContain("token=private");
    expect(JSON.stringify(validated.value)).not.toContain("/inbox");
    expect(validated.value.isLive()).toBe(true);
    expect(Object.isFrozen(validated.value)).toBe(true);
    expect(Object.isFrozen(validated.value.review)).toBe(true);
    expect(Object.isFrozen(validated.value.review.capabilities)).toBe(true);
    expect(validated.value.review.capabilities.every(Object.isFrozen)).toBe(true);
    expect(validated.value.validatedUrlForApproval()).toBe(REQUEST);
  });

  it("projects the grant client ID as an app claim without exposing its proof key", () => {
    const grantRequest = REQUEST.replace("pubkyauth://signin", "pubkyauth://signin_grant").replace(
      "&x-success=",
      "&cid=pubky.app&cpk=5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo&x-success=",
    );

    const validated = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(grantRequest));

    if (Result.isError(validated)) throw new Error(validated.error.code);
    expect(validated.value.review.authenticationMethod).toBe("grant");
    expect(validated.value.review.clientId).toBe("pubky.app");
    expect(Object.isFrozen(validated.value.review)).toBe(true);
    expect(JSON.stringify(validated.value.review)).not.toContain(
      "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo",
    );
  });

  it.each(["\n", "\u0007", "\u2028", "\u2029", "\u202e", "\u200b"])(
    "accepts a grant with an unsafe client ID without displaying it: %#",
    (character) => {
      const request = new URL(REQUEST.replace("pubkyauth://signin", "pubkyauth://signin_grant"));
      request.searchParams.set("cid", `app${character}claim`);
      request.searchParams.set("cpk", "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo");
      const result = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(request.href));
      if (Result.isError(result)) throw new Error(result.error.code);
      expect(result.value.review).not.toHaveProperty("clientId");
      expect(result.value.validatedUrlForApproval()).toBe(request.href);
      expect(result.value.isLive()).toBe(true);
    },
  );
  it("normalizes only the displayed client ID, preserving the approving URL", () => {
    const request = new URL(REQUEST.replace("pubkyauth://signin", "pubkyauth://signin_grant"));
    request.searchParams.set("cid", " cafe\u0301 ");
    request.searchParams.set("cpk", "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo");
    const result = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(request.href));
    if (Result.isError(result)) throw new Error(result.error.code);
    expect(result.value.review.clientId).toBe("café");
    expect(result.value.validatedUrlForApproval()).toBe(request.href);
  });

  it("grants the same NFC capability path shown in the review", () => {
    const request = REQUEST.replace("/pub/pubky.app/", "/pub/cafe\u0301/");
    const validated = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(request));
    if (Result.isError(validated)) throw new Error(validated.error.code);

    const approvalUrl = validated.value.validatedUrlForApproval();
    if (approvalUrl === undefined) throw new Error("Missing approval URL");
    expect(validated.value.review.capabilities[0]?.path).toBe("/pub/café/");
    expect(new URL(approvalUrl).searchParams.get("caps")).toContain("/pub/café/:rw");
  });

  it.each([
    ["success", "https://pubky.app/success?token=private"],
    ["error", "https://pubky.app/error"],
    ["cancel", "https://pubky.app/cancel"],
  ] as const)(
    "takes only the validated %s callback and releases the request",
    (outcome, callback) => {
      const validated = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(REQUEST));
      if (Result.isError(validated)) throw new Error(validated.error.code);

      expect(validated.value.takeOutcomeCallback(outcome)).toBe(callback);
      expect(validated.value.isLive()).toBe(false);
      expect(validated.value.validatedUrlForApproval()).toBeUndefined();
    },
  );

  it("rejects forged instances and releases private metadata explicitly", () => {
    const validated = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(REQUEST));
    if (Result.isError(validated)) throw new Error(validated.error.code);
    const forged = Object.create(
      Object.getPrototypeOf(validated.value),
    ) as ValidatedPubkyAuthRequest;

    expect(() => forged.validatedUrlForApproval()).toThrow(TypeError);

    validated.value.release();
    expect(validated.value.isLive()).toBe(false);
  });

  it("contains metadata access failures and releases the request", () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const validated = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(REQUEST));
    if (Result.isError(validated)) throw new Error(validated.error.code);
    const hostileOutcome = {
      [Symbol.toPrimitive]() {
        throw new TypeError(`metadata access failed ${SECRET} ${REQUEST}`);
      },
    } as unknown as "success";

    expect(validated.value.takeOutcomeCallback(hostileOutcome)).toBeUndefined();
    expect(validated.value.isLive()).toBe(false);
    expect(warning).toHaveBeenCalledWith("authorize.request_metadata.failed", {
      operation: "take_outcome_callback",
      diagnosticId: expect.any(String),
      errorName: "TypeError",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(warning.mock.calls)).not.toContain(REQUEST);
  });

  it("derives display hosts from fallback callbacks and preserves punycode", () => {
    const errorOnly = ValidatedPubkyAuthRequest.fromEncoded(
      encodeURIComponent(
        "pubkyauth://signin?caps=/pub/app/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-error=https://errors.example/error",
      ),
    );
    if (Result.isError(errorOnly)) throw new Error(errorOnly.error.code);
    expect(errorOnly.value.review.callbackHost).toBe("errors.example");

    const internationalized = ValidatedPubkyAuthRequest.fromEncoded(
      encodeURIComponent(
        "pubkyauth://signin?caps=/pub/app/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://\u0430pple.example/success",
      ),
    );
    if (Result.isError(internationalized)) throw new Error(internationalized.error.code);
    expect(internationalized.value.review.callbackHost).toBe("xn--pple-43d.example");
    expect(internationalized.value.review.callbackHost).not.toContain("\u0430");
  });

  it("includes a non-default callback port in the callback host", () => {
    const validated = ValidatedPubkyAuthRequest.fromEncoded(
      encodeURIComponent(
        "pubkyauth://signin?caps=/pub/app/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-success=https://app.example:8443/success",
      ),
    );
    if (Result.isError(validated)) throw new Error(validated.error.code);

    expect(validated.value.review.callbackHost).toBe("app.example:8443");
  });

  it("accepts namespace-scoped private folders as specific, next to a public one", () => {
    const validated = ValidatedPubkyAuthRequest.fromEncoded(
      encodeURIComponent(
        "pubkyauth://signin?caps=/pub/pubky.app/:rw,/priv/social/:rw,/priv/app.locks/content/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8",
      ),
    );
    if (Result.isError(validated)) throw new Error(validated.error.code);

    expect(validated.value.review.capabilities).toEqual([
      { path: "/pub/pubky.app/", read: true, write: true, scope: "specific" },
      { path: "/priv/social/", read: true, write: true, scope: "specific" },
      { path: "/priv/app.locks/content/", read: true, write: false, scope: "specific" },
    ]);
  });

  it("warns for every path that reaches a whole namespace, with or without its slash", () => {
    const validated = ValidatedPubkyAuthRequest.fromEncoded(
      encodeURIComponent(
        "pubkyauth://signin?caps=/:r,/pub:r,/pub/:r,/priv:r,/priv/:r,/priv/app/:r,/p:r,/pu:r,/pubx/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8",
      ),
    );
    if (Result.isError(validated)) throw new Error(validated.error.code);

    expect(validated.value.review.capabilities.map(({ path, scope }) => ({ path, scope }))).toEqual(
      [
        { path: "/", scope: "broad" },
        { path: "/pub", scope: "broad" },
        { path: "/pub/", scope: "broad" },
        { path: "/priv", scope: "broad" },
        { path: "/priv/", scope: "broad" },
        { path: "/priv/app/", scope: "specific" },
        { path: "/p", scope: "broad" },
        { path: "/pu", scope: "broad" },
        { path: "/pubx/", scope: "specific" },
      ],
    );
  });

  it.each([
    ["/", "all"],
    ["/p", "all"],
    ["/pub", "public"],
    ["/pub/", "public"],
    ["/pr", "private"],
    ["/priv", "private"],
    ["/priv/", "private"],
    ["/pub/app/", undefined],
    ["/pubx", undefined],
    ["/private/", undefined],
  ] as const)("reads the reach of %s as %s", (path, reach) => {
    expect(capabilityReach(path)).toBe(reach);
  });

  it("does not present the relay host as a callback host", () => {
    const validated = ValidatedPubkyAuthRequest.fromEncoded(
      encodeURIComponent(
        "pubkyauth://signin?caps=/pub/app/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8",
      ),
    );
    if (Result.isError(validated)) throw new Error(validated.error.code);

    expect(validated.value.review.callbackHost).toBeUndefined();
  });
});
