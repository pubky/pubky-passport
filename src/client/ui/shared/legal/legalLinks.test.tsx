/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pendingRequestPresence } from "@/client/logic/authorization/flow/pendingRequestPresence";

import { LegalConsent, LegalLinks } from "./legalLinks";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

describe("LegalLinks", () => {
  afterEach(cleanup);

  it("opens the legal pages in the same tab outside a request", () => {
    navigation.pathname = "/";
    render(<LegalLinks />);

    const terms = screen.getByRole("link", { name: "Terms of Service" });
    expect(terms).toHaveAttribute("href", "/terms-of-service");
    expect(terms).not.toHaveAttribute("target");
  });

  it("opens them in a new tab on the request entry, so the request stays open", () => {
    navigation.pathname = "/authorize";
    render(<LegalLinks />);

    for (const [name, href] of [
      ["Terms of Service (opens in a new tab)", "/terms-of-service"],
      ["Privacy Policy (opens in a new tab)", "/privacy-policy"],
    ] as const) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  // Last: once the page's controller has published, the path no longer decides.
  it("follows the request, not the path: new tabs while it waits, the same tab once answered", () => {
    navigation.pathname = "/authorize";
    render(<LegalLinks />);
    act(() => pendingRequestPresence.publish(true));
    expect(
      screen.getByRole("link", { name: "Terms of Service (opens in a new tab)" }),
    ).toHaveAttribute("target", "_blank");

    act(() => pendingRequestPresence.publish(false));
    expect(screen.getByRole("link", { name: "Terms of Service" })).not.toHaveAttribute("target");
  });
});

describe("LegalConsent", () => {
  const CONSENT =
    "By joining and creating a Pubky account, you agree to the Terms of Service and Privacy Policy, and confirm you are at least 18 years old.";

  afterEach(cleanup);

  it("says what creating an account agrees to, with both pages linked in the same tab outside a request", () => {
    navigation.pathname = "/";
    act(() => pendingRequestPresence.publish(false));
    const { container } = render(<LegalConsent />);

    const line = container.querySelector("p")!;
    expect(line.textContent).toBe(CONSENT);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Terms of Service", "/terms-of-service"],
      ["Privacy Policy", "/privacy-policy"],
    ]);
    for (const link of links) {
      expect(line).toContainElement(link);
      expect(link).not.toHaveAttribute("target");
      expect(link).not.toHaveAttribute("rel");
    }
    expect(screen.queryByText("(opens in a new tab)")).toBeNull();
  });

  it("opens both pages in a new tab while a request waits, and says so to assistive technology", () => {
    navigation.pathname = "/";
    act(() => pendingRequestPresence.publish(true));
    render(<LegalConsent />);

    for (const [name, href] of [
      ["Terms of Service (opens in a new tab)", "/terms-of-service"],
      ["Privacy Policy (opens in a new tab)", "/privacy-policy"],
    ] as const) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    // The note is in the links' names only: the line reads exactly as it does outside a request,
    // with no space trailing a link before its comma.
    expect(screen.getByText(/^By joining/u)).toHaveTextContent(
      "By joining and creating a Pubky account, you agree to the Terms of Service and Privacy Policy, and confirm you are at least 18 years old.",
    );

    // Once the request has its answer, the pages open in the tab again.
    act(() => pendingRequestPresence.publish(false));
    expect(screen.getByRole("link", { name: "Terms of Service" })).not.toHaveAttribute("target");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).not.toHaveAttribute("target");
  });
});
