import { describe, expect, it } from "vitest";

import { HttpResponseError } from "./HttpResponseError";

describe("HttpResponseError", () => {
  it("retains response diagnostics without making them serializable", () => {
    const responseBody = '{"secret":"response-canary"}';
    const cause = new Error("cause-canary");
    const error = new HttpResponseError(503, "Service Unavailable", responseBody, { cause });

    expect(error).toMatchObject({
      name: "HttpResponseError",
      message: "HTTP request failed with status 503.",
      status: 503,
      statusText: "Service Unavailable",
      responseBody,
      cause,
    });
    for (const property of ["status", "statusText", "responseBody"] as const) {
      expect(Object.prototype.propertyIsEnumerable.call(error, property)).toBe(false);
    }
    expect({ ...error }).not.toMatchObject({ status: 503, responseBody });
    expect(JSON.stringify(error)).not.toContain("response-canary");
    expect(JSON.stringify(error)).not.toContain("Service Unavailable");
  });
});
