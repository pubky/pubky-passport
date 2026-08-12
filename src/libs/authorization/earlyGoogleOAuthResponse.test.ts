import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import {
  EARLY_GOOGLE_OAUTH_RESPONSE_SCRIPT,
  GOOGLE_OAUTH_RESPONSE_MESSAGE_TYPE,
} from "./earlyGoogleOAuthResponse";

describe("early Google OAuth response bootstrap", () => {
  it("scrubs the credential fragment and sends it only to the opener", () => {
    const postMessage = vi.fn();
    const location = {
      pathname: "/google-oauth-callback",
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

    runInNewContext(EARLY_GOOGLE_OAUTH_RESPONSE_SCRIPT, context);

    expect(location.hash).toBe("");
    expect(postMessage).toHaveBeenCalledWith({
      type: GOOGLE_OAUTH_RESPONSE_MESSAGE_TYPE,
      status: "captured",
      hash: "#access_token=credential-canary&state=state-canary",
    }, "https://passport.example");
    expect(location.hash).not.toContain("credential-canary");
  });
});
