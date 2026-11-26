// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPassportAuth, PassportConfigError, type PassportAuthOptions } from "./index";
import { FakePopup, FakePubky, useHttpsPage } from "./testing/fakes";

function options(overrides: Partial<PassportAuthOptions> = {}): PassportAuthOptions {
  return {
    pubky: new FakePubky(),
    capabilities: "/pub/example.app/:rw",
    clientId: "example.app",
    appName: "Example App",
    ...overrides,
  };
}

function configError(overrides: Record<string, unknown>): PassportConfigError {
  try {
    createPassportAuth({ ...options(), ...overrides } as PassportAuthOptions);
  } catch (error) {
    expect(error).toBeInstanceOf(PassportConfigError);
    return error as PassportConfigError;
  }
  throw new Error("expected a PassportConfigError");
}

beforeEach(() => useHttpsPage());
afterEach(() => vi.restoreAllMocks());

describe("createPassportAuth options", () => {
  it("accepts the defaults", () => {
    const passport = createPassportAuth(options());
    expect(passport.state).toBe("idle");
  });

  it("uses passport.pubky.app by default", async () => {
    const popup = new FakePopup();
    vi.spyOn(window, "open").mockImplementation(() => popup.asWindow());
    const pubky = new FakePubky();
    const passport = createPassportAuth(options({ pubky }));
    void passport.signIn();
    pubky.starts[0]!.resolve({
      authorizationUrl: "pubkyauth://signin",
      tryPollOnce: () => new Promise(() => undefined),
      free: () => undefined,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(popup.location.replace).toHaveBeenCalledWith(
      `https://passport.pubky.app/authorize#d=${encodeURIComponent("pubkyauth://signin")}`,
    );
    passport.dispose();
  });

  it.each([
    "http://passport.example",
    "ftp://passport.example",
    "passport.example",
    "https://passport.example/authorize",
    "https://passport.example/?x=1",
    "https://passport.example/#d=1",
    "https://user:pass@passport.example",
    "",
    42,
  ])("refuses instance %s", (instance) => {
    expect(configError({ instance }).option).toBe("instance");
  });

  it.each([
    "https://passport.example/",
    "http://localhost:3000",
    "http://127.0.0.1:3533",
    "http://[::1]:8080",
  ])("accepts instance %s", (instance) => {
    expect(() => createPassportAuth(options({ instance }))).not.toThrow();
  });

  it.each(["/:rw", "/pub:rw", "/pub/:rw", "/priv:r", "/priv/:rwe", "/pub/example.app/:rw,/:r"])(
    "refuses the root capability %s",
    (capabilities) => {
      const error = configError({ capabilities });
      expect(error.option).toBe("capabilities");
      expect(error.message).toMatch(/root/u);
    },
  );

  it.each(["pub/example.app/:rw", "/pub/example.app/", "/pub/example.app/:x", 7])(
    "refuses malformed capabilities %s",
    (capabilities) => {
      expect(configError({ capabilities }).option).toBe("capabilities");
    },
  );

  it("accepts an empty capability list and nested /pub and /priv paths", () => {
    for (const capabilities of ["", "/pub/example.app/:rw", "/priv/example.app/:rwe"])
      expect(() => createPassportAuth(options({ capabilities }))).not.toThrow();
  });

  it.each([
    ["too long", "x".repeat(129)],
    ["empty", "   "],
    ["a control character", "Example\u0007App"],
    ["a bidi override", "Example‮App"],
    ["a zero-width space", "Example​App"],
    ["not a string", 5],
  ])("refuses an appName that is %s", (_, appName) => {
    expect(configError({ appName }).option).toBe("appName");
  });

  it("accepts a 128-character appName", () => {
    expect(() => createPassportAuth(options({ appName: "x".repeat(128) }))).not.toThrow();
  });

  it.each(["", "x".repeat(254), undefined])("refuses clientId %#", (clientId) => {
    expect(configError({ clientId }).option).toBe("clientId");
  });

  it.each([
    ["another origin", "https://other.example/passport/return"],
    ["another port", "https://app.example:8443/passport/return"],
    ["plain http", "http://app.example/passport/return"],
    ["a non-URL", "https://["],
    ["empty", ""],
    ["too long", `/passport/return?${"x".repeat(2_000)}`],
    ["too long once re-encoded", `/passport/return?next=${"/".repeat(700)}`],
    ["a path too long for the request once encoded three times", `/p/${"a/".repeat(850)}`],
  ])("refuses a callbackUrl on %s", (_, callbackUrl) => {
    expect(configError({ callbackUrl }).option).toBe("callbackUrl");
  });

  it("accepts an ordinary callback with a query", () => {
    const callbackUrl = `/passport/return?from=${"x".repeat(300)}`;
    expect(() => createPassportAuth(options({ callbackUrl }))).not.toThrow();
  });

  it("explains that a cross-origin callback cannot reach the page", () => {
    expect(configError({ callbackUrl: "https://other.example/r" }).message).toContain(
      "https://app.example",
    );
  });

  it("refuses an http callback even on loopback, because Passport refuses it", () => {
    useHttpsPage("http://localhost:3000/");
    expect(configError({ callbackUrl: "/passport/return" }).message).toMatch(/HTTPS/u);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, "5000"])(
    "refuses timeoutMs %s",
    (timeoutMs) => {
      expect(configError({ timeoutMs }).option).toBe("timeoutMs");
    },
  );

  it.each([undefined, null, {}, { startGrantAuthFlow: "no" }])("refuses pubky %#", (pubky) => {
    expect(configError({ pubky }).option).toBe("pubky");
  });
});
