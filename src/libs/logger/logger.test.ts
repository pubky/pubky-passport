import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER, safeErrorLogFields } from "./logger";

describe("LOGGER", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits stable event names and structured fields", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    LOGGER.info("authorize.parse.failed", {
      errorCode: "missing_secret",
      hasDeepLink: true,
      retryCount: 0,
      emptyValue: null,
      omittedValue: undefined,
    });

    expect(info).toHaveBeenCalledWith(
      'level=info event="authorize.parse.failed" errorCode="missing_secret" hasDeepLink=true retryCount=0 emptyValue=null',
    );
  });

  it("redacts Pubky authorization URLs before writing to the sink", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const authUrl =
      "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=auth-secret";

    LOGGER.warn("authorize.received", { authUrl });

    expect(warn).toHaveBeenCalledWith(
      'level=warn event="authorize.received" authUrl="[REDACTED_AUTHORIZATION_URL]"',
    );
    expect(warn.mock.calls[0]?.[0]).not.toContain("auth-secret");
  });

  it("redacts Passport authorize route URLs before writing to the sink", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const requestUrl =
      "https://passport.pubky.app/authorize?d=pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dauth-secret";

    LOGGER.info("authorize.request", { requestUrl });

    expect(info).toHaveBeenCalledWith(
      'level=info event="authorize.request" requestUrl="[REDACTED_AUTHORIZATION_URL]"',
    );
    expect(info.mock.calls[0]?.[0]).not.toContain("auth-secret");
  });

  it("redacts callback query parameters before writing to the sink", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    LOGGER.error("authorize.callback.failed", {
      callbackUrl:
        "https://app.example/passport-success?code=callback-secret&state=private#fragment-secret",
    });

    expect(error).toHaveBeenCalledWith(
      'level=error event="authorize.callback.failed" callbackUrl="https://app.example/passport-success?[REDACTED_URL_PARAMS]"',
    );
    expect(error.mock.calls[0]?.[0]).not.toContain("callback-secret");
    expect(error.mock.calls[0]?.[0]).not.toContain("fragment-secret");
  });

  it("redacts token-like field values before writing to the sink", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const wrappingKey = "MOHBXchuOcfSN--B55rzy9qrkZ8p5VhvVxAWqxszg7Y";

    LOGGER.debug("google.token.debug", {
      authorization: "Authorization: Bearer ya29.fake-drive-token",
      googleIdToken: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
      wrappingKey,
    });

    const output = debug.mock.calls[0]?.[0];

    expect(output).toContain('authorization="Authorization: Bearer [REDACTED_TOKEN]"');
    expect(output).toContain('googleIdToken="[REDACTED_TOKEN]"');
    expect(output).toContain('wrappingKey="[REDACTED_TOKEN]"');
    expect(output).not.toContain("ya29.fake-drive-token");
    expect(output).not.toContain("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature");
    expect(output).not.toContain(wrappingKey);
  });

  it("escapes dynamic field keys to prevent log-line injection", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    LOGGER.info("authorize.parse.failed", { ["errorCode\nlevel=error"]: "missing_secret" });

    expect(info).toHaveBeenCalledWith(
      'level=info event="authorize.parse.failed" "errorCode\\nlevel=error"="missing_secret"',
    );
    expect(info.mock.calls[0]?.[0]).not.toContain("\n");
  });

  it("does not let sink failures alter application control flow", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("sink failed");
    });

    expect(() => LOGGER.warn("authorize.approval.failed")).not.toThrow();
  });

  it("correlates nested failures without exposing messages or stacks", () => {
    const cause = new TypeError("sensitive token contents");
    const wrapped = { code: "operation_failed", cause };

    const first = safeErrorLogFields(wrapped);
    const second = safeErrorLogFields(cause);

    expect(first).toEqual(second);
    expect(first.errorName).toBe("TypeError");
    expect(first.diagnosticId).toEqual(expect.any(String));
    expect(JSON.stringify(first)).not.toContain("sensitive token contents");
    expect(JSON.stringify(first)).not.toContain("stack");
  });

  it("does not expose an attacker-controlled error name", () => {
    const sensitiveName = "shortSensitiveCredential";

    const fields = safeErrorLogFields({ name: sensitiveName });

    expect(fields.errorName).toBe("ErrorLike");
    expect(fields.diagnosticId).toEqual(expect.any(String));
    expect(JSON.stringify(fields)).not.toContain(sensitiveName);
  });
});
