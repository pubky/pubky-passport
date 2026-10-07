/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecoveryCard, RecoveryScreen } from "./recoveryScreen";

describe("RecoveryScreen", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("moves focus to the display heading of each new step", () => {
    const { rerender } = render(
      <RecoveryScreen title="Encrypted" accent="backup." description="Choose a password.">
        <button type="button">Download</button>
      </RecoveryScreen>,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Encrypted backup." });
    expect(heading).toHaveFocus();
    // The same display heading as every other setup step, with its last words in the accent.
    expect(heading).toHaveClass(
      "text-[length:clamp(1.75rem,calc((100vw_-_3rem)/6.4),3rem)]",
      "md:text-6xl",
    );
    expect(screen.getByText("backup.")).toHaveClass("text-brand");
    // The lead keeps to a readable measure on the wide track.
    expect(screen.getByText("Choose a password.")).toHaveClass("max-w-3xl");
    // No bordered dialog card around a step.
    expect(heading.closest("section")).toBeNull();

    screen.getByRole("button", { name: "Download" }).focus();
    rerender(
      <RecoveryScreen title="Verify" accent="backup." description="Select the file.">
        <button type="button">Verify</button>
      </RecoveryScreen>,
    );

    expect(screen.getByRole("heading", { name: "Verify backup." })).toHaveFocus();
  });

  it("keeps a confirmation in a bordered card that reads as a dialog", () => {
    render(
      <RecoveryScreen variant="confirm" title="Log out of this identity?" description="Sure?">
        <button type="button">Log out</button>
      </RecoveryScreen>,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Log out of this identity?" });
    expect(heading).toHaveFocus();
    expect(heading).toHaveClass("text-2xl");
    // Across the track like every card from md, its content in a readable column.
    const card = heading.closest("section");
    expect(card).toHaveClass("rounded-2xl", "border", "bg-popover", "md:p-12");
    expect(heading.parentElement?.parentElement).toHaveClass("max-w-3xl");
    expect(heading.parentElement?.parentElement?.parentElement).toBe(card);
  });

  it("lays a step's fields out in account creation's card across the track", () => {
    render(
      <RecoveryCard illustration="/illustrations/file.png">
        <label htmlFor="password">Password</label>
        <input id="password" />
      </RecoveryCard>,
    );

    const field = screen.getByLabelText("Password");
    const card = field.closest("section");
    // A card from md with 48px padding, its fields in a 576px column; plain on a phone.
    expect(card).toHaveClass("md:p-12", "max-md:bg-transparent", "max-md:p-0");
    expect(field.parentElement).toHaveClass("md:max-w-xl");
    // The illustration from lg, at the wide card's size.
    expect(card?.querySelector("img")).toHaveClass("lg:block", "lg:size-48");
  });
});
