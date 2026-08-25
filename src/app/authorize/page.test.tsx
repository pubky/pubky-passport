/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AuthorizePage from "./page";

vi.mock("../../client/ui/authorization/authorizationFlow", () => ({
  AuthorizationFlow: () => <main>Authorization flow</main>,
}));

describe("AuthorizePage", () => {
  it("renders the authorization feature", () => {
    render(<AuthorizePage />);
    expect(screen.getByText("Authorization flow")).toBeInTheDocument();
  });
});
