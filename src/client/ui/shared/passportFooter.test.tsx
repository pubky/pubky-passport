/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderChoice } from "@/client/ui/onboarding/providerChoice";
import { PassportFooter } from "./passportFooter";

/** The globals.css rules that target the footer's "powered by" line, as written. */
function builtByRules(): string {
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  return (css.match(/[^{}/]*\[data-passport-footer-built-by\][^{}]*\{[^{}]*\}/gu) ?? []).join("\n");
}

/** The footer's own "Pubky Passport is powered by the Pubky protocol…" paragraph. */
function footerBuiltByLine(): HTMLElement {
  return within(screen.getByRole("contentinfo")).getByText(/^Pubky Passport is powered by the/u);
}

afterEach(() => {
  cleanup();
  document.head.querySelectorAll("style[data-test-globals]").forEach((style) => style.remove());
});

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

describe("PassportFooter next to the sign-in Terms notice", () => {
  it("hides only its powered-by line while the notice is on the page, and shows it again after", () => {
    const style = document.createElement("style");
    style.dataset.testGlobals = "";
    style.textContent = builtByRules();
    document.head.append(style);
    expect(style.textContent).toMatch(/display:\s*none/u);

    const { rerender } = render(
      <>
        <main>
          <ProviderChoice apple={null} onContinueWithGoogle={vi.fn()} />
        </main>
        <PassportFooter />
      </>,
    );
    const footer = screen.getByRole("contentinfo");
    const line = footerBuiltByLine();
    expect(line).toHaveTextContent(
      "Pubky Passport is powered by the Pubky protocol. Built by Synonym Software, S.A. DE C.V. ©2026.",
    );
    expect(getComputedStyle(line).display).toBe("none");
    // The rest of the footer stays: Terms, Privacy and the Synonym badge are not inside the line.
    for (const name of ["Terms of Service", "Privacy Policy"]) {
      const link = within(footer).getByRole("link", { name });
      expect(line).not.toContainElement(link);
      expect(getComputedStyle(link).display).not.toBe("none");
    }
    expect(line).not.toContainElement(
      within(footer).getByRole("img", { name: "Synonym, a Tether company" }),
    );
    expect(getComputedStyle(footer).display).not.toBe("none");

    // Any other page (no notice) keeps the line, without a reload.
    rerender(
      <>
        <main />
        <PassportFooter />
      </>,
    );
    expect(getComputedStyle(footerBuiltByLine()).display).not.toBe("none");
  });

  it("keeps the line on a page without the notice", () => {
    const style = document.createElement("style");
    style.dataset.testGlobals = "";
    style.textContent = builtByRules();
    document.head.append(style);

    render(<PassportFooter />);
    expect(getComputedStyle(footerBuiltByLine()).display).not.toBe("none");
  });
});
