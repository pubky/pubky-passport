/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderChoice } from "@/client/ui/onboarding/providerChoice";
import { PassportFooter } from "./passportFooter";

/** The globals.css rules that hide the footer, as written. */
function footerRules(): string {
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  return (css.match(/[^{}/]*\.passport-footer[^{}]*\{[^{}]*\}/gu) ?? []).join("\n");
}

function installFooterRules(): HTMLStyleElement {
  const style = document.createElement("style");
  style.dataset.testGlobals = "";
  style.textContent = footerRules();
  document.head.append(style);
  return style;
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
  it("is hidden while the notice is on the page, and shows again after", () => {
    expect(installFooterRules().textContent).toMatch(
      /body:has\(\[data-passport-sign-in-notice\]\)\s*\.passport-footer\s*\{\s*display:\s*none/u,
    );

    const { rerender } = render(
      <>
        <main>
          <ProviderChoice apple={null} onContinueWithGoogle={vi.fn()} />
        </main>
        <PassportFooter />
      </>,
    );
    // The notice brings its own Synonym badge, so the footer's Terms, Privacy and badge all go.
    const footer = document.querySelector<HTMLElement>("body > div > footer.passport-footer");
    expect(footer).not.toBeNull();
    expect(getComputedStyle(footer!).display).toBe("none");
    expect(
      within(screen.getByRole("main")).getByRole("img", { name: "Synonym, a Tether company" }),
    ).toBeInTheDocument();

    // Any other page (no notice) shows the footer again, without a reload.
    rerender(
      <>
        <main />
        <PassportFooter />
      </>,
    );
    expect(getComputedStyle(screen.getByRole("contentinfo")).display).not.toBe("none");
  });

  it("stays on a page without the notice", () => {
    installFooterRules();
    render(<PassportFooter />);
    const footer = screen.getByRole("contentinfo");
    expect(getComputedStyle(footer).display).not.toBe("none");
    expect(within(footer).getByText(/^Pubky Passport is powered by the/u)).toBeInTheDocument();
  });
});
