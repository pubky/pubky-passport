import { expect, it } from "vitest";
import type { AuthorizationRequestReview } from "../request/ValidatedPubkyAuthRequest";
import { describeCallbackWarning } from "./describeCallbackWarning";

const review = (callbackHost?: string): AuthorizationRequestReview => ({
  authenticationMethod: "grant",
  capabilities: [],
  ...(callbackHost ? { callbackHost } : {}),
  requesterName: "real.example",
  clientId: "real.example",
});
const opener = (verifiedOrigin = "https://real.example") => ({
  verifiedOrigin,
  attemptId: "0123456789abcdef",
  features: [],
});

it("does not warn without both a callback and a browser binding", () => {
  expect(describeCallbackWarning(undefined, opener())).toBeUndefined();
  expect(describeCallbackWarning(review(), opener())).toBeUndefined();
  expect(describeCallbackWarning(review("other.example"))).toBeUndefined();
});

it.each([
  ["real.example", "https://real.example"],
  ["real.example:8443", "https://real.example:8443"],
  ["xn--bcher-kva.example", "https://xn--bcher-kva.example"],
  ["[::1]:5173", "https://[::1]:5173"],
])("omits the warning for the same full origin %s", (host, origin) => {
  expect(describeCallbackWarning(review(host), opener(origin))).toBeUndefined();
});

it.each([
  ["other.example", "https://real.example", "real.example"],
  ["real.example:8443", "https://real.example", "real.example"],
  ["real.example", "https://real.example:8443", "real.example:8443"],
  ["localhost:5173", "http://localhost:5173", "localhost:5173"],
  ["xn--bcher-kva.example:8443", "https://real.example", "real.example"],
])("compares origins independently of app claims: %s / %s", (host, origin, openerHost) => {
  expect(describeCallbackWarning(review(host), opener(origin))).toEqual({
    callbackHost: host,
    openerHost,
  });
});
