/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SetupComplete } from "./setup-complete";

const IDENTITY = { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" };

describe("SetupComplete", () => {
  it("labels a restored identity as restore complete", () => {
    render(<SetupComplete identity={IDENTITY} mode="restored" onContinue={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Restore complete." })).toBeInTheDocument();
    expect(screen.getByText("Restored backup from Google Drive.")).toBeInTheDocument();
  });

  it("labels a newly created identity as setup complete", () => {
    render(<SetupComplete identity={IDENTITY} mode="created" onContinue={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Setup complete." })).toBeInTheDocument();
  });
});
