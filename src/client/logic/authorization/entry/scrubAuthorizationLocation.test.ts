/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";

import { scrubAuthorizationLocation } from "./scrubAuthorizationLocation";

describe("scrubAuthorizationLocation", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("preserves safe framework history state during a repeated hydration scrub", () => {
    const frameworkState = { __NA: true, tree: ["", { children: ["authorize"] }] };
    window.history.replaceState(
      frameworkState,
      "",
      "/authorize#d=encoded-request",
    );

    scrubAuthorizationLocation(window, { preserveSanitizedHistoryState: true });

    expect(window.history.state).toEqual(frameworkState);
    expect(window.location.hash).toBe("");
  });

  it("clears framework history state that contains authorization data", () => {
    const sensitiveUrl = "/authorize#d=encoded-request";
    window.history.replaceState({ url: sensitiveUrl }, "", sensitiveUrl);

    scrubAuthorizationLocation(window, { preserveSanitizedHistoryState: true });

    expect(window.history.state).toBeNull();
    expect(window.location.hash).toBe("");
  });
});
