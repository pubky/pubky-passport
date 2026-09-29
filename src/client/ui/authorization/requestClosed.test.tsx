/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequestClosed } from "./requestClosed";

describe("RequestClosed", () => {
  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "opener", { configurable: true, value: null });
    vi.restoreAllMocks();
  });

  it("says the request ended and closes the app's popup", async () => {
    Object.defineProperty(window, "opener", { configurable: true, value: { closed: false } });
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    render(<RequestClosed />);

    expect(screen.getByRole("heading", { name: "Sign-in request closed." })).toHaveFocus();
    expect(screen.getByText(/the request it opened with has ended/u)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Close window" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("offers Passport's start page in a tab of its own", () => {
    render(<RequestClosed />);

    expect(screen.getByRole("button", { name: "Go to Passport" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close window" })).not.toBeInTheDocument();
  });
});
