import { describe, expect, it } from "vitest";

import {
  redactAuthorizationUrls,
  redactCallbackUrlQuery,
  redactForLog,
  redactTokenLikeValues,
} from "./redaction";

describe("redactAuthorizationUrls", () => {
  it("redacts raw Pubky authorization URLs", () => {
    const value = "auth=pubkyauth://signin?caps=/pub/pubky.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=secret-value";

    expect(redactAuthorizationUrls(value)).toBe("auth=[REDACTED_AUTHORIZATION_URL]");
  });

  it("redacts HTTPS Passport authorization URLs", () => {
    const value = "GET https://passport.pubky.app/authorize?d=pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dsecret-value";

    expect(redactAuthorizationUrls(value)).toBe("GET [REDACTED_AUTHORIZATION_URL]");
  });

  it("redacts relative Passport authorization URLs", () => {
    const value = "GET /authorize?foo=bar&d=pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dsecret-value";

    expect(redactAuthorizationUrls(value)).toBe("GET [REDACTED_AUTHORIZATION_URL]");
  });

  it("redacts relative Passport authorization URLs in key value log fields", () => {
    const value = "url=/authorize?d=pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dsecret-value";

    expect(redactAuthorizationUrls(value)).toBe("url=[REDACTED_AUTHORIZATION_URL]");
  });

  it("redacts localhost authorization URLs for development log safety", () => {
    const value = "GET http://localhost:3000/authorize?d=pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dsecret-value";

    expect(redactAuthorizationUrls(value)).toBe("GET [REDACTED_AUTHORIZATION_URL]");
  });

  it("leaves non-authorization URLs unchanged", () => {
    const value = "GET https://passport.pubky.app/dashboard?tab=identity";

    expect(redactAuthorizationUrls(value)).toBe(value);
  });
});

describe("redactCallbackUrlQuery", () => {
  it("redacts callback URL query parameters", () => {
    const value = "callback=https://app.example/passport-success?code=secret&state=private";

    expect(redactCallbackUrlQuery(value)).toBe("callback=https://app.example/passport-success?[REDACTED_URL_PARAMS]");
  });

  it("drops fragments when query parameters are redacted", () => {
    const value = "callback=https://app.example/passport-success?code=secret#fragment-secret";

    expect(redactCallbackUrlQuery(value)).toBe("callback=https://app.example/passport-success?[REDACTED_URL_PARAMS]");
  });

  it("redacts callback URL fragments without query parameters", () => {
    const value = "callback=https://app.example/passport-success#token=fragment-secret";

    expect(redactCallbackUrlQuery(value)).toBe("callback=https://app.example/passport-success?[REDACTED_URL_PARAMS]");
  });

  it("leaves callback URLs without query parameters unchanged", () => {
    const value = "callback=https://app.example/passport-success";

    expect(redactCallbackUrlQuery(value)).toBe(value);
  });
});

describe("redactTokenLikeValues", () => {
  it("redacts bearer tokens", () => {
    const value = "Authorization: Bearer ya29.a0AfH6SMCvVerySecretToken";

    expect(redactTokenLikeValues(value)).toBe("Authorization: Bearer [REDACTED_TOKEN]");
  });

  it("redacts non-bearer authorization header tokens", () => {
    const value = "Authorization: Basic abc123-secret";

    expect(redactTokenLikeValues(value)).toBe("Authorization: Basic [REDACTED_TOKEN]");
  });

  it("redacts JWT-like strings", () => {
    const value = "id=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature";

    expect(redactTokenLikeValues(value)).toBe("id=[REDACTED_TOKEN]");
  });

  it("redacts sensitive key value pairs with equals and colon separators", () => {
    const value = "id_token=abc access_token:def token=ghi secret=jkl wrapping_key=mno credential=pqr";

    expect(redactTokenLikeValues(value)).toBe(
      "id_token=[REDACTED_TOKEN] access_token=[REDACTED_TOKEN] token=[REDACTED_TOKEN] secret=[REDACTED_TOKEN] wrapping_key=[REDACTED_TOKEN] credential=[REDACTED_TOKEN]",
    );
  });

  it("redacts quoted JSON-style token values", () => {
    const value = '{"access_token":"secret-value","id_token":"another-secret"}';

    expect(redactTokenLikeValues(value)).toBe('{"access_token":"[REDACTED_TOKEN]","id_token":"[REDACTED_TOKEN]"}');
  });

  it("redacts sensitive query-like pairs", () => {
    const value = "callback?access_token=secret-value&state=public";

    expect(redactTokenLikeValues(value)).toBe("callback?access_token=[REDACTED_TOKEN]&state=public");
  });

  it("redacts long opaque token-like strings", () => {
    const value = "opaque=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    expect(redactTokenLikeValues(value)).toBe("opaque=[REDACTED_TOKEN]");
  });
});

describe("redactForLog", () => {
  it("applies authorization URL, callback URL, and token redaction together", () => {
    const value = "authorize=https://passport.pubky.app/authorize?d=secret callback=https://app.example/cb?token=secret Authorization: Bearer secret-token";

    expect(redactForLog(value)).toBe(
      "authorize=[REDACTED_AUTHORIZATION_URL] callback=https://app.example/cb?[REDACTED_URL_PARAMS] Authorization: Bearer [REDACTED_TOKEN]",
    );
  });

  it("does not leave relative authorization request parameters in redacted output", () => {
    const value = "GET /authorize?d=pubkyauth%3A%2F%2Fsignin%3Fsecret%3Dsecret-value";

    expect(redactForLog(value)).toBe("GET [REDACTED_AUTHORIZATION_URL]");
  });

  it("does not leave representative raw secrets in redacted output", () => {
    const value = "pubkyauth://signin?secret=auth-secret callback=https://app.example/cb?code=callback-secret token=token-secret";

    const redacted = redactForLog(value);
 
    expect(redacted).not.toContain("auth-secret");
    expect(redacted).not.toContain("callback-secret");
    expect(redacted).not.toContain("token-secret");
  });

  it("is deterministic for the same input", () => {
    const value = "Authorization: Bearer deterministic-token callback=https://app.example/cb?secret=value";

    expect(redactForLog(value)).toBe(redactForLog(value));
  });
});
