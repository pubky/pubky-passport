// @vitest-environment node
import { expect, it } from "vitest";
import type { AuthorizationRequestReview } from "../request/ValidatedPubkyAuthRequest";
import type { VerifiedOpener } from "./OpenerChannel";
import { describeAuthorizationRequester, verifiedOwnHost } from "./describeAuthorizationRequester";

const review: AuthorizationRequestReview = {
  authenticationMethod: "grant",
  capabilities: [],
  requesterName: "Claimed app",
  clientId: "claimed.example",
  callbackHost: "callback.example",
};
const opener = (verifiedOrigin: string): VerifiedOpener => ({
  verifiedOrigin,
  attemptId: "0123456789abcdef",
  features: [],
});

it.each([
  ["https://real.example", "real.example"],
  ["https://real.example:8443", "real.example:8443"],
  ["https://xn--pple-43d.example", "xn--pple-43d.example"],
])(
  "names the bound opener's host rather than app claims, without verification wording: %s",
  (origin, label) => {
    expect(describeAuthorizationRequester(opener(origin))).toEqual({ label });
  },
);

it.each(["http://localhost:5173", "http://127.0.0.1", "http://[::1]:5173"])(
  "identifies HTTP loopback as a local development app: %s",
  (origin) => {
    expect(describeAuthorizationRequester(opener(origin))).toEqual({
      label: `Local development app (${origin})`,
    });
  },
);

it("names nobody without a bound opener: the callback host and label are the request's own claims", () => {
  expect(describeAuthorizationRequester()).toBeUndefined();
});

it.each([
  ["https://callback.example", "callback.example"],
  ["https://real.example", undefined],
  // Another scheme or port is another origin.
  ["https://callback.example:8443", undefined],
  ["http://localhost:5173", undefined],
])("calls the callback folder the app's own only for its verified opener %s", (origin, host) => {
  expect(verifiedOwnHost(review, opener(origin))).toBe(host);
});

it.each([
  [undefined, opener("https://callback.example")],
  [{ authenticationMethod: "grant", capabilities: [] }, opener("https://callback.example")],
  [review, undefined],
] as const)(
  "knows no own folder without both a callback and a bound opener: %#",
  (value, bound) => {
    expect(verifiedOwnHost(value, bound)).toBeUndefined();
  },
);
