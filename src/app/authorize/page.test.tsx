/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AuthorizePage from "./page";

const commitInitialEntry = vi.fn();

vi.mock("../../browser/authorization/passportAuthorization", () => ({
  createPassportAuthorizationController: () => ({ commitInitialEntry }),
}));

describe("AuthorizePage", () => {
  it("scrubs the entry and renders the replacement UI placeholder", async () => {
    render(<AuthorizePage />);

    expect(screen.getByRole("heading", { name: "Authorization" })).toBeInTheDocument();
    expect(screen.getByText(/under construction/u)).toBeInTheDocument();
    await waitFor(() => expect(commitInitialEntry).toHaveBeenCalledOnce());
  });
});
