/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequestHeading, requestWindowTitle } from "./requestHeading";

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

describe("RequestHeading", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows a label's long stack of combining marks cut, clipped to its own line", () => {
    const label = `Acme${"\u0332".repeat(100)}`;
    render(
      <RequestHeading review={{ ...REVIEW, callbackHost: "evil.example", requesterName: label }} />,
    );

    const name = screen.getByText(`Acme${"\u0332".repeat(3)}`, { selector: "bdi" });
    expect(name).toHaveClass("overflow-hidden");
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName(
      `Sign in to Acme${"\u0332".repeat(3)}`,
    );
    expect(screen.getByText("evil.example")).toBeVisible();
  });

  it("gives the app's name a line of its own at every width", () => {
    render(<RequestHeading review={{ ...REVIEW, callbackHost: "notes.example" }} />);

    const name = screen.getByText("notes.example", { selector: "bdi" });
    expect(name).toHaveClass("block");
    expect(name).not.toHaveClass("md:inline");
    expect(name.parentElement).toHaveClass("block", "md:block");
  });

  it("tightens the leading of a name shrunk to fit, so its lines stay together", () => {
    // jsdom has no layout: a 300px column and a name that needs 900px on one line.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(900);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      display: "block",
      fontSize: "60px",
    } as CSSStyleDeclaration);
    render(
      <RequestHeading
        review={{ ...REVIEW, callbackHost: "notes.example", requesterName: "Acme Notes Pro" }}
      />,
    );

    const name = screen.getByText("Acme Notes Pro", { selector: "bdi" });
    expect(name.style.fontSize).toBe("32px");
    expect(name.style.lineHeight).toBe("1.1");
    expect(name.style.whiteSpace).toBe("normal");
  });
});
