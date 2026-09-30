import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import {
  EARLY_GOOGLE_IMPLICIT_RESPONSE_MAX_CHARACTERS,
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
      History: {
        prototype: {
          replaceState() {
            location.hash = "";
          },
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      opener: { postMessage },
    };
    context.window = context;

    runInNewContext(EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT, context);

    expect(location.hash).toBe("");
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE,
        status: "captured",
        hash: "#access_token=credential-canary&state=state-canary",
      },
      "https://passport.example",
    );
    expect(location.hash).not.toContain("credential-canary");
  });

  it.each(["#access_token=access-canary", "#id_token=id-canary&state=state-canary"])(
    "scrubs a malformed sensitive fragment before the app loads",
    (hash) => {
      const postMessage = vi.fn();
      const location = {
        pathname: "/",
        hash,
        origin: "https://passport.example",
      };
      const context: Record<string, unknown> = {
        location,
        history: {},
        History: {
          prototype: {
            replaceState() {
              location.hash = "";
            },
          },
        },
        opener: { postMessage },
      };
      context.window = context;

      runInNewContext(EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT, context);

      expect(location.hash).toBe("");
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE,
          status: "captured",
          hash,
        },
        "https://passport.example",
      );
    },
  );

  it.each([
    [EARLY_GOOGLE_IMPLICIT_RESPONSE_MAX_CHARACTERS, "captured"],
    [EARLY_GOOGLE_IMPLICIT_RESPONSE_MAX_CHARACTERS + 1, "too_large"],
  ] as const)("handles a credential fragment of %i characters as %s", (length, status) => {
    const postMessage = vi.fn();
    const prefix = "#access_token=";
    const hash = prefix.padEnd(length, "a");
    const location = { pathname: "/", hash, origin: "https://passport.example" };
    const context: Record<string, unknown> = {
      location,
      history: {},
      History: {
        prototype: {
          replaceState() {
            location.hash = "";
          },
        },
      },
      opener: { postMessage },
    };
    context.window = context;

    runInNewContext(EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT, context);

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE, status }),
      "https://passport.example",
    );
    const response = postMessage.mock.calls[0]?.[0];
    expect(response).toEqual(
      status === "captured"
        ? { type: GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE, status, hash }
        : { type: GOOGLE_IMPLICIT_RESPONSE_MESSAGE_TYPE, status },
    );
  });

  it("stops loading and navigates to a clean URL when native scrubbing fails", () => {
    const postMessage = vi.fn();
    const stop = vi.fn();
    const location = {
      pathname: "/",
      hash: "#access_token=credential-canary&state=state-canary",
      origin: "https://passport.example",
      replace: vi.fn(() => {
        location.hash = "";
      }),
    };
    const context: Record<string, unknown> = {
      location,
      history: {},
      History: {
        prototype: {
          replaceState() {
            throw new Error("unavailable");
          },
        },
      },
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

  it("still navigates to a clean URL when stopping the page throws", () => {
    const postMessage = vi.fn();
    const location = {
      pathname: "/",
      hash: "#id_token=credential-canary&state=state-canary",
      origin: "https://passport.example",
      replace: vi.fn(() => {
        location.hash = "";
      }),
    };
    const context: Record<string, unknown> = {
      location,
      history: {},
      History: {
        prototype: {
          replaceState() {
            throw new Error("unavailable");
          },
        },
      },
      opener: { postMessage },
      stop() {
        throw new Error("unavailable");
      },
    };
    context.window = context;

    runInNewContext(EARLY_GOOGLE_IMPLICIT_RESPONSE_SCRIPT, context);

    expect(location.replace).toHaveBeenCalledWith("/");
    expect(location.hash).toBe("");
    expect(postMessage).not.toHaveBeenCalled();
  });
});
