/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pendingRequestPresence } from "@/client/logic/authorization/flow/pendingRequestPresence";

import { LegalLinks } from "./legalLinks";

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
