import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "@/libs/logger/logger";
import { ValidatedPubkyAuthRequest } from "./ValidatedPubkyAuthRequest";

const REQUEST =
  "pubkyauth://signin?caps=/pub/pubky.app/:rw,/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-source=Pubky%20App&x-success=https://pubky.app/success?token=private&x-error=https://pubky.app/error&x-cancel=https://pubky.app/cancel";
const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

describe("ValidatedPubkyAuthRequest", () => {
  it("declines encryption while retaining storage and the signed HPKE approval format", () => {
    const request = signedRequest("/priv/chat/v1/:rwe,/pub/profile/:r");
    const original = request.validatedUrlForApproval();
    const approved = new URL(request.validatedUrlForApproval(["/priv/chat/v1/"])!);

    expect(approved.searchParams.get("caps")).toBe("/priv/chat/v1/:rw,/pub/profile/:r");
    expect(approved.searchParams.get("af")).toBe("v1");
    expect(approved.searchParams.get("epk")).toBe(SECRET);
    expect(approved.searchParams.has("secret")).toBe(false);
    expect(approved.searchParams.get("cid")).toBe("pubky.app");
    expect(request.validatedUrlForApproval()).toBe(original);
    expect(request.review.capabilities[0]?.encrypt).toBe(true);
    expect(JSON.stringify(request.review)).not.toContain(SECRET);
  });

  it("declines an encryption-only scope without granting any storage action", () => {
    const request = signedRequest("/pub/chat/:e");
    const approved = new URL(request.validatedUrlForApproval(["/pub/chat/"])!);

    expect(approved.searchParams.get("caps")).toBe("");
    expect(approved.searchParams.get("af")).toBe("v1");
    expect(approved.searchParams.get("epk")).toBe(SECRET);
  });

  it("keeps keys on independently approved scopes", () => {
    const request = signedRequest("/priv/chat/:rwe,/priv/photos/:rwe");
    const approved = new URL(request.validatedUrlForApproval(["/priv/chat/"])!);

    expect(approved.searchParams.get("caps")).toBe("/priv/chat/:rw,/priv/photos/:rwe");
  });

  it("removes covering directory keys so a declined scope cannot still be derived", () => {
    const request = signedRequest("/priv/:re,/priv/chat/:rwe,/priv/photos/:e");
    const approved = new URL(request.validatedUrlForApproval(["/priv/chat/"])!);

    expect(approved.searchParams.get("caps")).toBe("/priv/:r,/priv/chat/:rw,/priv/photos/:e");
  });

  it("keeps unrelated file and sibling keys when a directory is declined", () => {
    const request = signedRequest("/priv/chat:e,/priv/chat/:rwe,/priv/chat-other/:e");
    const approved = new URL(request.validatedUrlForApproval(["/priv/chat/"])!);

    expect(approved.searchParams.get("caps")).toBe(
      "/priv/chat:e,/priv/chat/:rw,/priv/chat-other/:e",
    );
  });

  it("removes duplicate encryption permissions for the same scope", () => {
    const request = signedRequest("/priv/chat/:rwe,/priv/chat/:e");
    const approved = new URL(request.validatedUrlForApproval(["/priv/chat/"])!);

    expect(approved.searchParams.get("caps")).toBe("/priv/chat/:rw");
  });

  it("preserves distinct Unicode key scopes when narrowing consent", () => {
    const request = signedRequest("/priv/cafe\u0301/:rwe,/priv/café/:e");
    const approved = new URL(request.validatedUrlForApproval(["/priv/cafe\u0301/"])!);

    expect(approved.searchParams.get("caps")).toBe("/priv/cafe\u0301/:rw,/priv/café/:e");
  });

  it("rejects unknown declined scopes and cannot produce an approval after release", () => {
    const request = signedRequest("/priv/chat/:rwe");

    expect(request.validatedUrlForApproval(["/priv/other/"])).toBeUndefined();
    request.release();
    expect(request.validatedUrlForApproval(["/priv/chat/"])).toBeUndefined();
  });

  afterEach(() => vi.restoreAllMocks());

  it("creates an immutable safe review and exact approval authority", () => {
    const validated = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(REQUEST));
    if (Result.isError(validated)) throw new Error(validated.error.code);

    expect(validated.value.review).toEqual({
      authenticationMethod: "cookie",
      capabilities: [
        { path: "/pub/pubky.app/", read: true, write: true, encrypt: false, scope: "specific" },
        { path: "/", read: true, write: false, encrypt: false, scope: "broad" },
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

  it("projects the v0.10 grant method without exposing proof parameters", () => {
    const grantRequest = REQUEST.replace("pubkyauth://signin", "pubkyauth://signin_grant").replace(
      "&x-success=",
      "&cid=pubky.app&cpk=5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo&x-success=",
    );

    const validated = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(grantRequest));

    if (Result.isError(validated)) throw new Error(validated.error.code);
    expect(validated.value.review.authenticationMethod).toBe("grant");
    expect(validated.value.review).not.toHaveProperty("clientId");
    expect(JSON.stringify(validated.value.review)).not.toContain(
      "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo",
    );
  });

  it("preserves the exact capability path bytes shown in the review", () => {
    const request = REQUEST.replace("/pub/pubky.app/", "/pub/cafe\u0301/");
    const validated = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(request));
    if (Result.isError(validated)) throw new Error(validated.error.code);

    const approvalUrl = validated.value.validatedUrlForApproval();
    if (approvalUrl === undefined) throw new Error("Missing approval URL");
    expect(validated.value.review.capabilities[0]?.path).toBe("/pub/cafe\u0301/");
    expect(new URL(approvalUrl).searchParams.get("caps")).toContain("/pub/cafe\u0301/:rw");
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

  it("warns only for namespace-wide capability paths", () => {
    const validated = ValidatedPubkyAuthRequest.fromEncoded(
      encodeURIComponent(
        "pubkyauth://signin?caps=/:r,/pub:r,/pub/:r,/priv:r,/priv/:r,/priv/app/:r&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8",
      ),
    );
    if (Result.isError(validated)) throw new Error(validated.error.code);

    expect(validated.value.review.capabilities.map(({ path, scope }) => ({ path, scope }))).toEqual(
      [
        { path: "/", scope: "broad" },
        { path: "/pub", scope: "specific" },
        { path: "/pub/", scope: "broad" },
        { path: "/priv", scope: "specific" },
        { path: "/priv/", scope: "broad" },
        { path: "/priv/app/", scope: "specific" },
      ],
    );
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

function signedRequest(capabilities: string): ValidatedPubkyAuthRequest {
  const request = new URL(
    `pubkyauth://signin_grant?relay=https://relay.example/inbox&epk=${SECRET}&af=v1&cid=pubky.app&cpk=5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo`,
  );
  request.searchParams.set("caps", capabilities);
  const validated = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(request.toString()));
  if (Result.isError(validated)) throw new Error(validated.error.code);
  return validated.value;
}
