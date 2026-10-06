/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NotFound, { metadata } from "./not-found";

describe("not found page", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("looks like Passport, says what happened and leads back", () => {
    render(<NotFound />);

    expect(screen.getByRole("main")).toBeInTheDocument();
    const heading = screen.getByRole("heading", { level: 1, name: "Page not found." });
    expect(heading).toHaveClass(
      "text-[length:clamp(1.75rem,calc((100vw_-_3rem)/6.4),3rem)]",
      "md:text-6xl",
    );
    expect(screen.getByText(/go back to the app and start signing in again/u)).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to Passport" })).toHaveAttribute("href", "/");
    expect(metadata.title).toBe("Page not found | Pubky Passport");
  });
});
