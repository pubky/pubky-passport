// @vitest-environment node
import { expect, it } from "vitest";
import type { AuthorizationRequestReview } from "../request/ValidatedPubkyAuthRequest";
import type { VerifiedOpener } from "./OpenerChannel";
import { describeAuthorizationRequester } from "./describeAuthorizationRequester";

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
    expect(describeAuthorizationRequester(review, opener(origin))).toEqual({ label });
  },
);

it.each(["http://localhost:5173", "http://127.0.0.1", "http://[::1]:5173"])(
  "identifies HTTP loopback as a local development app: %s",
  (origin) => {
    expect(describeAuthorizationRequester(review, opener(origin))).toEqual({
      label: `Local development app (${origin})`,
    });
  },
);

it("names the validated callback host without a hello", () => {
  expect(describeAuthorizationRequester(review)).toEqual({ label: "callback.example" });
});

it.each([
  undefined,
  {
    authenticationMethod: "grant",
    capabilities: [],
    requesterName: "Claimed app",
    clientId: "claimed.example",
  } as const,
])("does not treat an app name or client ID as a requester origin: %#", (value) => {
  expect(describeAuthorizationRequester(value)).toBeUndefined();
});
