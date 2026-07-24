import { describe, expect, it } from "vitest";

import { parseHomegateBaseUrl } from "./parseHomegateBaseUrl";

describe("parseHomegateBaseUrl", () => {
  it.each([
    ["https://homegate.example", "https://homegate.example/", "https://homegate.example"],
    ["https://homegate.example/api", "https://homegate.example/api/", "https://homegate.example"],
    ["https://homegate.example:8443/", "https://homegate.example:8443/", "https://homegate.example:8443"],
    ["https://localhost:8443/", "https://localhost:8443/", "https://localhost:8443"],
  ])("normalizes the CSP-safe HTTPS base URL %s", (value, href, origin) => {
    expect(parseHomegateBaseUrl(value)).toEqual({ href, origin });
  });

  it.each([
    "not a URL",
    "http://homegate.example",
    "https://user:password@homegate.example",
    "https://homegate.example?unexpected=true",
    "https://homegate.example#fragment",
    "https://homegate.example?",
    "https://homegate.example#",
    "https://*",
    "https://*.example.com",
    "https://homegate;source.example",
    "https://homegate,source.example",
    "https://home_gate.example",
    "https://homegate..example",
    "https://-homegate.example",
    "https://homegate-.example",
    "https://192.0.2.1",
    "https://[2001:db8::1]",
    `https://${"a".repeat(64)}.example`,
    `https://${"a".repeat(2048)}.example`,
  ])("rejects unsafe Homegate base URL %s", (value) => {
    expect(parseHomegateBaseUrl(value)).toBeNull();
  });
});
