import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SignInPage } from "./signInPage";

describe("SignInPage", () => {
  it("renders the signed-out Passport actions", () => {
    render(<SignInPage><button type="button">Provider action</button></SignInPage>);

    expect(screen.getByRole("heading", { name: "Quick & easy signing." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Provider action" })).toBeInTheDocument();
  });
});
/** @vitest-environment jsdom */
