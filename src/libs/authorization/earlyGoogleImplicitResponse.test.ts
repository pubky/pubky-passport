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

  it.each([
    "#access_token=access-canary",
    "#id_token=id-canary&state=state-canary",
  ])("scrubs a malformed sensitive fragment before the app loads", (hash) => {
    const postMessage = vi.fn();
    const location = {
      pathname: "/",
      hash,
      origin: "https://passport.example",
    };
    const context: Record<string, unknown> = {
      location,
      history: {},
      History: { prototype: { replaceState() { location.hash = ""; } } },
      opener: { postMessage },
    };
    context.window = context;

    runInNewContext(EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT, context);

    expect(location.hash).toBe("");
    expect(postMessage).toHaveBeenCalledWith({
      type: GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE,
      status: "captured",
      hash,
    }, "https://passport.example");
  });

  it("stops loading and navigates to a clean URL when native scrubbing fails", () => {
    const postMessage = vi.fn();
    const stop = vi.fn();
    const location = {
      pathname: "/",
      hash: "#access_token=credential-canary&state=state-canary",
      origin: "https://passport.example",
      replace: vi.fn(() => { location.hash = ""; }),
    };
    const context: Record<string, unknown> = {
      location,
      history: {},
      History: { prototype: { replaceState() { throw new Error("unavailable"); } } },
      opener: { postMessage },
      stop,
    };
    context.window = context;

    runInNewContext(EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT, context);

    expect(stop).toHaveBeenCalledOnce();
    expect(location.replace).toHaveBeenCalledWith("/");
    expect(location.hash).toBe("");
    expect(postMessage).not.toHaveBeenCalled();
  });
});
