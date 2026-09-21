/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PassportFooter } from "./passportFooter";

describe("PassportFooter", () => {
  it("renders legal and brand links in document flow", () => {
    render(<PassportFooter />);

    const footer = screen.getByRole("contentinfo");
    expect(footer).not.toHaveClass("fixed", "sticky");
    expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
      "href",
      "/terms-of-service",
    );
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "/privacy-policy",
    );
    expect(screen.getByRole("link", { name: "Pubky protocol" })).toHaveAttribute(
      "href",
      "https://pubky.org/",
    );
    expect(screen.getByRole("img", { name: "Synonym, a Tether company" })).toBeInTheDocument();
  });
});
