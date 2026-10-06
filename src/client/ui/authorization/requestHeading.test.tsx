/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OPENER_HELLO_GRACE_MS } from "@/client/logic/authorization/opener/OpenerChannel";
import { bindTestOpener, installTestOpener, releaseTestOpener } from "@test-utils/boundOpener";
import { RequestHeading, requestWindowTitle } from "./requestHeading";

const REVIEW = {
  authenticationMethod: "cookie",
  capabilities: [{ path: "/pub/notes.example/", read: true, write: true, scope: "specific" }],
} as const;

describe("requestWindowTitle", () => {
  it("names the callback host beside an app label that differs from it", () => {
    expect(
      requestWindowTitle(
        { ...REVIEW, callbackHost: "evil.example", requesterName: "Google" },
        true,
      ),
    ).toBe("Signing in to Google (evil.example)");
  });

  it("names the callback host once when the label is the host or there is no label", () => {
    expect(
      requestWindowTitle(
        { ...REVIEW, callbackHost: "notes.example", requesterName: "notes.example" },
        true,
      ),
    ).toBe("Signing in to notes.example");
    expect(requestWindowTitle({ ...REVIEW, callbackHost: "notes.example" }, true)).toBe(
      "Signing in to notes.example",
    );
  });

  it("never names a request after its label alone, nor one nobody verified", () => {
    expect(requestWindowTitle({ ...REVIEW, requesterName: "Google" }, true)).toBe(
      "Sign-in request",
    );
    expect(requestWindowTitle(REVIEW, true)).toBe("Sign-in request");
    expect(
      requestWindowTitle(
        { ...REVIEW, callbackHost: "evil.example", requesterName: "Google" },
        false,
      ),
    ).toBe("Sign-in request");
  });
});

describe("RequestHeading for a request a v2 hello bound", () => {
  beforeEach(() => bindTestOpener("https://evil.example"));
  afterEach(() => {
    cleanup();
    releaseTestOpener();
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
      `Signing in to Acme${"\u0332".repeat(3)}`,
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

describe("RequestHeading for a request nobody verified (M3)", () => {
  afterEach(() => {
    cleanup();
    releaseTestOpener();
    vi.useRealTimers();
  });

  it("names no website as the requester, marks its own label unverified, and warns", () => {
    render(
      <RequestHeading
        hostId="host"
        review={{ ...REVIEW, callbackHost: "evil.example", requesterName: "Google" }}
      />,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveAccessibleName("Sign-in request.");
    expect(heading).toHaveAttribute("data-window-title", "Sign-in request");
    // One flowing line where it fits, as the Pubky Ring hand-off's heading.
    expect(heading).toHaveClass("[&>span]:inline");
    expect(screen.queryByText(/Signing in to|Website:|evil\.example/u)).toBeNull();
    expect(screen.getByText("Google", { selector: "bdi" }).parentElement).toHaveTextContent(
      "Name in the request: Google (unverified)",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Passport can’t confirm who sent this request.",
    );
    expect(screen.getByRole("status")).toHaveAttribute("id", "host");
  });

  it("leaves the warning to the screen that asks for it, and needs no label", () => {
    render(
      <RequestHeading review={{ ...REVIEW, callbackHost: "notes.example" }} warning={false} />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Sign-in request.");
    expect(screen.queryByText(/Name in the request/u)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stays neutral while a popup's hello may still bind it, and warns once none did", () => {
    vi.useFakeTimers();
    installTestOpener();
    render(
      <RequestHeading
        review={{ ...REVIEW, callbackHost: "evil.example", requesterName: "Google" }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Sign-in request.");
    expect(screen.queryByRole("status")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(OPENER_HELLO_GRACE_MS);
    });
    // No hello came: nobody verified who asks.
    expect(screen.getByRole("status")).toHaveTextContent("can’t confirm who sent this request");
  });

  it("names the app once the popup's hello binds the request", () => {
    const channel = installTestOpener();
    render(
      <RequestHeading
        review={{ ...REVIEW, callbackHost: "evil.example", requesterName: "Google" }}
      />,
    );
    channel.hello("https://evil.example");
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Signing in to Google");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
