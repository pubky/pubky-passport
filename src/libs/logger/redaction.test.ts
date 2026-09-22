import { describe, expect, it } from "vitest";

import { redactForLog } from "./redaction";

describe("redactForLog authorization URLs", () => {
  it("redacts raw Pubky authorization URLs", () => {
    const value =
      "auth=pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=secret-value";

    expect(redactForLog(value)).toBe("auth=[REDACTED_AUTHORIZATION_URL]");
  });

  it("redacts HTTPS Passport authorization URLs", () => {
    const value =
      "GET https://passport.pubky.app/authorize#d=pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dsecret-value";

    expect(redactForLog(value)).toBe("GET [REDACTED_AUTHORIZATION_URL]");
  });

  it("redacts relative Passport authorization URLs", () => {
    const value = "GET /authorize#d=pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dsecret-value";

    expect(redactForLog(value)).toBe("GET [REDACTED_AUTHORIZATION_URL]");
  });

  it("redacts relative Passport authorization URLs in key value log fields", () => {
    const value = "url=/authorize#d=pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dsecret-value";

    expect(redactForLog(value)).toBe("url=[REDACTED_AUTHORIZATION_URL]");
  });

  it("redacts rejected relative fragments when d is not the first parameter", () => {
    const value =
      "GET /authorize#unexpected=value&d=pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dsecret-value";

    expect(redactForLog(value)).toBe("GET [REDACTED_AUTHORIZATION_URL]");
  });

  it("redacts relative authorization fragments with encoded parameter names", () => {
    const value = "GET /authorize#%64=pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dsecret-value";

    expect(redactForLog(value)).toBe("GET [REDACTED_AUTHORIZATION_URL]");
  });

  it("redacts authorization URLs containing sensitive requests", () => {
    const value =
      "GET https://passport.pubky.app/authorize#d=pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dsecret-value";

    expect(redactForLog(value)).toBe("GET [REDACTED_AUTHORIZATION_URL]");
  });

  it("leaves URLs without parameters unchanged", () => {
    const value = "GET https://passport.pubky.app/dashboard";

    expect(redactForLog(value)).toBe(value);
  });
});

describe("redactForLog HTTP URL parameters", () => {
  it("redacts callback URL query parameters", () => {
    const value = "callback=https://app.example/passport-success?code=secret&state=private";

    expect(redactForLog(value)).toBe(
      "callback=https://app.example/passport-success?[REDACTED_URL_PARAMS]",
    );
  });

  it("drops fragments when query parameters are redacted", () => {
    const value = "callback=https://app.example/passport-success?code=secret#fragment-secret";

    expect(redactForLog(value)).toBe(
      "callback=https://app.example/passport-success?[REDACTED_URL_PARAMS]",
    );
  });

  it("redacts callback URL fragments without query parameters", () => {
    const value = "callback=https://app.example/passport-success#token=fragment-secret";

    expect(redactForLog(value)).toBe(
      "callback=https://app.example/passport-success?[REDACTED_URL_PARAMS]",
    );
  });

  it("leaves callback URLs without query parameters unchanged", () => {
    const value = "callback=https://app.example/passport-success";

    expect(redactForLog(value)).toBe(value);
  });
});

describe("redactForLog sensitive and opaque values", () => {
  it("redacts bearer tokens", () => {
    const value = "Authorization: Bearer ya29.a0AfH6SMCvVerySecretToken";

    expect(redactForLog(value)).toBe("Authorization: Bearer [REDACTED_TOKEN]");
  });

  it("redacts non-bearer authorization header tokens", () => {
    const value = "Authorization: Basic abc123-secret";

    expect(redactForLog(value)).toBe("Authorization: Basic [REDACTED_TOKEN]");
  });

  it("redacts JWT-like strings", () => {
    const value = "id=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature";

    expect(redactForLog(value)).toBe("id=[REDACTED_TOKEN]");
  });

  it("redacts sensitive key value pairs with equals and colon separators", () => {
    const value =
      "id_token=abc access_token:def token=ghi secret=jkl wrapping_key=mno credential=pqr signupCode=stu signupToken=vwx";

    expect(redactForLog(value)).toBe(
      "id_token=[REDACTED_TOKEN] access_token=[REDACTED_TOKEN] token=[REDACTED_TOKEN] secret=[REDACTED_TOKEN] wrapping_key=[REDACTED_TOKEN] credential=[REDACTED_TOKEN] signupCode=[REDACTED_TOKEN] signupToken=[REDACTED_TOKEN]",
    );
  });

  it("redacts quoted JSON-style token values", () => {
    const value = '{"access_token":"secret-value","id_token":"another-secret"}';

    expect(redactForLog(value)).toBe(
      '{"access_token":"[REDACTED_TOKEN]","id_token":"[REDACTED_TOKEN]"}',
    );
  });

  it("redacts sensitive query-like pairs", () => {
    const value = "callback?access_token=secret-value&state=public";

    expect(redactForLog(value)).toBe("callback?access_token=[REDACTED_TOKEN]&state=public");
  });

  it("redacts long opaque token-like strings", () => {
    const value = "opaque=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    expect(redactForLog(value)).toBe("opaque=[REDACTED_TOKEN]");
  });

  it("redacts bare 43-char base64url secrets without key or URL context", () => {
    // A 32-byte value encoded as base64url is exactly 43 characters, matching
    // the server-derived wrapping key and the Pubky auth client_secret.
    const wrappingKey = "MOHBXchuOcfSN--B55rzy9qrkZ8p5VhvVxAWqxszg7Y";
    expect(wrappingKey).toHaveLength(43);

    expect(redactForLog(`derived ${wrappingKey} value`)).toBe("derived [REDACTED_TOKEN] value");
  });

  it("redacts bare standard-base64 server secrets containing slash characters", () => {
    const serverSecret = "//////////////////////////////////////////8=";
    expect(Buffer.from(serverSecret, "base64")).toHaveLength(32);

    expect(redactForLog(`derived ${serverSecret} value`)).toBe("derived [REDACTED_TOKEN] value");
    expect(redactForLog(`serverSecretBase64=${serverSecret}`)).toBe(
      "serverSecretBase64=[REDACTED_TOKEN]",
    );
  });

  it("intentionally redacts z32 public keys under the fail-closed opaque-value rule", () => {
    const publicKeyZ32 = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";

    expect(redactForLog(`identity ${publicKeyZ32}`)).toBe("identity [REDACTED_TOKEN]");
  });

  it("does not redact 40-char hex diagnostics such as git SHA-1 hashes", () => {
    // The threshold stays above 40 so non-sensitive identifiers remain useful.
    const gitSha = "da39a3ee5e6b4b0d3255bfef95601890afd80709";
    expect(gitSha).toHaveLength(40);

    expect(redactForLog(`commit ${gitSha} built`)).toBe(`commit ${gitSha} built`);
  });
});

describe("redactForLog", () => {
  it("applies authorization URL, callback URL, and token redaction together", () => {
    const value =
      "authorize=https://passport.pubky.app/authorize?d=secret callback=https://app.example/cb?token=secret Authorization: Bearer secret-token";

    expect(redactForLog(value)).toBe(
      "authorize=[REDACTED_AUTHORIZATION_URL] callback=https://app.example/cb?[REDACTED_URL_PARAMS] Authorization: Bearer [REDACTED_TOKEN]",
    );
  });

  it("does not leave relative authorization request parameters in redacted output", () => {
    const value = "GET /authorize?d=pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dsecret-value";

    expect(redactForLog(value)).toBe("GET [REDACTED_AUTHORIZATION_URL]");
  });

  it("does not leave representative raw secrets in redacted output", () => {
    const value =
      "pubkyauth://signin?secret=auth-secret callback=https://app.example/cb?code=callback-secret token=token-secret";

    const redacted = redactForLog(value);

    expect(redacted).not.toContain("auth-secret");
    expect(redacted).not.toContain("callback-secret");
    expect(redacted).not.toContain("token-secret");
  });

  it("redacts bare 43-char base64url wrapping keys and auth secrets", () => {
    // 32-byte base64url secrets are 43 chars: the wrapping key handed to the
    // browser and the Pubky auth client_secret can both appear as bare tokens.
    const wrappingKey = "MOHBXchuOcfSN--B55rzy9qrkZ8p5VhvVxAWqxszg7Y";
    const authSecret = "xVuzgq5VHqr9iBsqrxs42M2TC4NJoeAqO__ZFYK41-k";
    expect(wrappingKey).toHaveLength(43);
    expect(authSecret).toHaveLength(43);

    const redacted = redactForLog(`wrappingKey ${wrappingKey} authSecret ${authSecret}`);

    expect(redacted).not.toContain(wrappingKey);
    expect(redacted).not.toContain(authSecret);
    expect(redacted).toBe("wrappingKey [REDACTED_TOKEN] authSecret [REDACTED_TOKEN]");
  });

  it("is deterministic for the same input", () => {
    const value =
      "Authorization: Bearer deterministic-token callback=https://app.example/cb?secret=value";

    expect(redactForLog(value)).toBe(redactForLog(value));
  });
});
