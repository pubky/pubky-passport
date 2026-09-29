import { describe, expect, it } from "vitest";

import { requestWindowTitle } from "./requestHeading";

const REVIEW = {
  authenticationMethod: "cookie",
  capabilities: [{ path: "/pub/notes.example/", read: true, write: true, scope: "specific" }],
} as const;

describe("requestWindowTitle", () => {
  it("names the callback host beside an app label that differs from it", () => {
    expect(
      requestWindowTitle({ ...REVIEW, callbackHost: "evil.example", requesterName: "Google" }),
    ).toBe("Sign in to Google (evil.example)");
  });

  it("names the callback host once when the label is the host or there is no label", () => {
    expect(
      requestWindowTitle({
        ...REVIEW,
        callbackHost: "notes.example",
        requesterName: "notes.example",
      }),
    ).toBe("Sign in to notes.example");
    expect(requestWindowTitle({ ...REVIEW, callbackHost: "notes.example" })).toBe(
      "Sign in to notes.example",
    );
  });

  it("never names a request after its label alone", () => {
    expect(requestWindowTitle({ ...REVIEW, requesterName: "Google" })).toBe("Sign-in request");
    expect(requestWindowTitle(REVIEW)).toBe("Sign-in request");
  });
});
