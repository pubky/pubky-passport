import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SignInPage } from "./signInPage";

describe("SignInPage", () => {
  it("renders the signed-out Passport actions", () => {
    render(<SignInPage />);

    expect(screen.getByRole("heading", { name: "Quick & easy signing." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeDisabled();
  });
});
/** @vitest-environment jsdom */
