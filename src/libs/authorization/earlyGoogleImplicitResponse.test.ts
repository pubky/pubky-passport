import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import {
  EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT,
  GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE,
} from "./earlyGoogleImplicitResponse";

describe("early Google implicit response bootstrap", () => {
  it("scrubs the credential fragment and sends it only to the opener", () => {
    const postMessage = vi.fn();
    const location = {
      pathname: "/",
      hash: "#access_token=credential-canary&state=state-canary",
      origin: "https://passport.example",
    };
    const context: Record<string, unknown> = {
      location,
      history: {},
      History: { prototype: { replaceState() { location.hash = ""; } } },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      opener: { postMessage },
    };
    context.window = context;

    runInNewContext(EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT, context);

    expect(location.hash).toBe("");
    expect(postMessage).toHaveBeenCalledWith({
      type: GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE,
      status: "captured",
      hash: "#access_token=credential-canary&state=state-canary",
    }, "https://passport.example");
    expect(location.hash).not.toContain("credential-canary");
  });
});
