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

  it("moves focus to the heading of each new step", () => {
    const { rerender } = render(
      <RecoveryScreen title="Encrypted backup." description="Choose a password.">
        <button type="button">Download</button>
      </RecoveryScreen>,
    );
    expect(screen.getByRole("heading", { name: "Encrypted backup." })).toHaveFocus();
    expect(screen.getByText("Choose a password.")).toBeInTheDocument();

    screen.getByRole("button", { name: "Download" }).focus();
    rerender(
      <RecoveryScreen title="Verify backup." description="Select the file.">
        <button type="button">Verify</button>
      </RecoveryScreen>,
    );

    expect(screen.getByRole("heading", { name: "Verify backup." })).toHaveFocus();
  });
});
