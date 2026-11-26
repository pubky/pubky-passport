// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handlePassportReturn } from "./return";
import { useHttpsPage } from "./testing/fakes";

const ATTEMPT = "4f6c7d0e-8a9b-4c1d-9e2f-0a1b2c3d4e5f";

function setOpener(opener: unknown): void {
  Object.defineProperty(window, "opener", { configurable: true, value: opener });
}

function opener() {
  return { closed: false, postMessage: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, "close").mockImplementation(() => undefined);
});

afterEach(() => {
  setOpener(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("handlePassportReturn", () => {
  it.each(["success", "error", "cancel"])(
    "forwards %s to the opener on this origin, then closes",
    (outcome) => {
      useHttpsPage(
        `https://app.example/passport/return?passport-attempt=${ATTEMPT}&passport-outcome=${outcome}`,
      );
      const target = opener();
      setOpener(target);

      expect(handlePassportReturn()).toEqual({ status: "forwarded", outcome });
      expect(target.postMessage).toHaveBeenCalledWith(
        { type: "pubky-passport-auth.return", version: 1, attemptId: ATTEMPT, outcome },
        "https://app.example",
      );
      // Closing waits a task so the message is queued first.
      expect(window.close).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(window.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["no query", ""],
    ["an unknown outcome", `?passport-attempt=${ATTEMPT}&passport-outcome=approved`],
    ["no attempt", "?passport-outcome=success"],
    ["an oversized attempt", `?passport-attempt=${"a".repeat(129)}&passport-outcome=success`],
  ])("does nothing for %s", (_, query) => {
    useHttpsPage(`https://app.example/passport/return${query}`);
    const target = opener();
    setOpener(target);

    expect(handlePassportReturn()).toEqual({ status: "invalid" });
    expect(target.postMessage).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(window.close).not.toHaveBeenCalled();
  });

  it.each([
    ["no opener", null],
    ["a closed opener", { closed: true, postMessage: vi.fn() }],
    [
      "an opener that throws",
      {
        closed: false,
        postMessage: () => {
          throw new Error("detached");
        },
      },
    ],
  ])("stays open with %s so the page can show a link back", (_, target) => {
    useHttpsPage(
      `https://app.example/passport/return?passport-attempt=${ATTEMPT}&passport-outcome=cancel`,
    );
    setOpener(target);

    expect(handlePassportReturn()).toEqual({ status: "no-opener", outcome: "cancel" });
    vi.runAllTimers();
    expect(window.close).not.toHaveBeenCalled();
  });
});
