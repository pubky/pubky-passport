/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PassportLogo } from "./passportLogo";

describe("PassportLogo", () => {
  it("links the logo to the home page", () => {
    render(<PassportLogo />);

    expect(screen.getByRole("link", { name: "Pubky" })).toHaveAttribute("href", "/");
  });
});
