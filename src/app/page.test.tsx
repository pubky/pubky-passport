/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Home from "./page";

vi.mock("../client/ui/identity-dashboard/identityDashboard", () => ({
  IdentityDashboard: () => <main>Identity dashboard</main>,
}));

describe("Home", () => {
  it("renders the identity dashboard", () => {
    render(<Home />);
    expect(screen.getByText("Identity dashboard")).toBeInTheDocument();
  });
});
