/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecoveryScreen } from "./recoveryScreen";

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
    expect(screen.getByText("Choose a password.")).toBeInTheDocument();
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
    expect(heading.closest("section")).toHaveClass("rounded-2xl", "border", "bg-popover");
  });
});
