import { describe, expect, it } from "vitest";

import {
  createRequestWrappingKeyController,
  type RequestWrappingKeyControllerResult,
} from "./requestWrappingKeyController";
import type { RequestWrappingKeyErrorCode, RequestWrappingKeyResult } from "../../application/identity/requestWrappingKey";

describe("requestWrappingKeyController", () => {
  it("maps the Google wire token field to neutral use-case input", async () => {
    const calls: unknown[] = [];
    const controller = createRequestWrappingKeyController(async input => {
      calls.push(input);
      return { ok: true, wrappingKey: "wrapping-key" };
    });

    await expect(controller({ googleIdToken: "id-token" })).resolves.toEqual<RequestWrappingKeyControllerResult>({
      status: 200,
      body: { wrappingKey: "wrapping-key" },
    });
    expect(calls).toEqual([{ provider: "google", idToken: "id-token" }]);
  });

  it.each([
    ["invalid_id_token", "invalid_google_id_token", 401],
    ["expired_id_token", "expired_google_id_token", 401],
    ["unsupported_issuer", "unsupported_google_issuer", 401],
    ["unsupported_audience", "unsupported_google_audience", 401],
    ["missing_subject", "missing_google_subject", 401],
    ["rate_limited", "rate_limited", 429],
    ["dependency_unavailable", "dependency_unavailable", 503],
  ] as const)("maps neutral %s to wire %s", async (coreCode, wireCode, status) => {
    const controller = createRequestWrappingKeyController(async () => failure(coreCode));

    await expect(controller({ googleIdToken: "id-token" })).resolves.toEqual<RequestWrappingKeyControllerResult>({
      status,
      body: { error: { code: wireCode } },
    });
  });
});

function failure(code: RequestWrappingKeyErrorCode): Extract<RequestWrappingKeyResult, { ok: false }> {
  return { ok: false, error: { code } };
}
