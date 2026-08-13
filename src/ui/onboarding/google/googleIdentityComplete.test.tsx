/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GoogleIdentityComplete } from "./googleIdentityComplete";

const IDENTITY = { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" };
const GOOGLE_ACCOUNT = { id: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: null };

describe("GoogleIdentityComplete", () => {
  it("labels a restored identity as restore complete", () => {
    const { container } = render(<GoogleIdentityComplete googleAccount={GOOGLE_ACCOUNT} identity={IDENTITY} mode="restored" onContinue={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Restore complete." })).toBeInTheDocument();
    expect(screen.getByText("Restored backup from Google Drive.")).toBeInTheDocument();
    expect(screen.getByText("Satoshi Nakamoto")).toBeInTheDocument();
    expect(screen.getByText("satoshi@gmail.com")).toBeInTheDocument();
    expect(container.querySelector('[data-slot="setup-complete-illustration"]')).toHaveAttribute("src", expect.stringContaining("passport-setup-complete.png"));
  });

  it("labels a newly created identity as setup complete", () => {
    render(<GoogleIdentityComplete googleAccount={GOOGLE_ACCOUNT} identity={IDENTITY} mode="created" onContinue={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Setup complete." })).toBeInTheDocument();
  });
});
