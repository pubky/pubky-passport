import { describe, expect, it } from "vitest";

import { createLogger, type LogLevel, type LogSink } from "./logger";

describe("createLogger", () => {
  it("emits stable event names and structured fields", () => {
    const records = createLogRecords();
    const logger = createLogger(records.sink);

    logger.info("authorize.parse.failed", {
      errorCode: "missing_secret",
      hasDeepLink: true,
      retryCount: 0,
      emptyValue: null,
      omittedValue: undefined,
    });

    expect(records.info).toEqual([
      'level=info event="authorize.parse.failed" errorCode="missing_secret" hasDeepLink=true retryCount=0 emptyValue=null',
    ]);
  });

  it("redacts Pubky authorization URLs before writing to the sink", () => {
    const records = createLogRecords();
    const logger = createLogger(records.sink);
    const authUrl = "pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=auth-secret";

    logger.warn("authorize.received", { authUrl });

    expect(records.warn).toEqual(['level=warn event="authorize.received" authUrl="[REDACTED_AUTHORIZATION_URL]"']);
    expect(records.warn.join("\n")).not.toContain("auth-secret");
  });

  it("redacts Passport authorize route URLs before writing to the sink", () => {
    const records = createLogRecords();
    const logger = createLogger(records.sink);
    const requestUrl = "https://passport.pubky.app/authorize?d=pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dauth-secret";

    logger.info("authorize.request", { requestUrl });

    expect(records.info).toEqual(['level=info event="authorize.request" requestUrl="[REDACTED_AUTHORIZATION_URL]"']);
    expect(records.info.join("\n")).not.toContain("auth-secret");
  });

  it("redacts callback query parameters before writing to the sink", () => {
    const records = createLogRecords();
    const logger = createLogger(records.sink);

    logger.error("authorize.callback.failed", {
      callbackUrl: "https://app.example/passport-success?code=callback-secret&state=private#fragment-secret",
    });

    expect(records.error).toEqual([
      'level=error event="authorize.callback.failed" callbackUrl="https://app.example/passport-success?[REDACTED_URL_PARAMS]"',
    ]);
    expect(records.error.join("\n")).not.toContain("callback-secret");
    expect(records.error.join("\n")).not.toContain("fragment-secret");
  });

  it("redacts token-like field values before writing to the sink", () => {
    const records = createLogRecords();
    const logger = createLogger(records.sink);
    const wrappingKey = "MOHBXchuOcfSN--B55rzy9qrkZ8p5VhvVxAWqxszg7Y";

    logger.debug("google.token.debug", {
      authorization: "Authorization: Bearer ya29.fake-drive-token",
      googleIdToken: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
      wrappingKey,
    });

    const output = records.debug.join("\n");

    expect(output).toContain('authorization="Authorization: Bearer [REDACTED_TOKEN]"');
    expect(output).toContain('googleIdToken="[REDACTED_TOKEN]"');
    expect(output).toContain('wrappingKey="[REDACTED_TOKEN]"');
    expect(output).not.toContain("ya29.fake-drive-token");
    expect(output).not.toContain("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature");
    expect(output).not.toContain(wrappingKey);
  });

  it("escapes dynamic field keys to prevent log-line injection", () => {
    const records = createLogRecords();
    const logger = createLogger(records.sink);

    logger.info("authorize.parse.failed", { ["errorCode\nlevel=error"]: "missing_secret" });

    expect(records.info).toEqual([
      'level=info event="authorize.parse.failed" "errorCode\\nlevel=error"="missing_secret"',
    ]);
    expect(records.info[0]).not.toContain("\n");
  });
});

function createLogRecords(): Record<LogLevel, string[]> & { sink: LogSink } {
  const records: Record<LogLevel, string[]> = {
    debug: [],
    info: [],
    warn: [],
    error: [],
  };

  return {
    ...records,
    sink: {
      debug(message) {
        records.debug.push(message);
      },
      info(message) {
        records.info.push(message);
      },
      warn(message) {
        records.warn.push(message);
      },
      error(message) {
        records.error.push(message);
      },
    },
  };
}
