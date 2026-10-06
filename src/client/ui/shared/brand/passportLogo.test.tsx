/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pendingRequestPresence } from "@/client/logic/authorization/flow/pendingRequestPresence";

import { PassportLogo } from "./passportLogo";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

describe("PassportLogo", () => {
  afterEach(cleanup);

  it("links the logo to the home page", () => {
    navigation.pathname = "/";
    render(<PassportLogo />);

    expect(screen.getByRole("link", { name: "Pubky" })).toHaveAttribute("href", "/");
  });

  it("leads nowhere on the request entry, where leaving would drop the request", () => {
    navigation.pathname = "/authorize";
    render(<PassportLogo />);

    expect(screen.getByRole("img", { name: "Pubky" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  // Last: once the page's controller has published, the path no longer decides.
  it("links home again once the request has its answer", () => {
    navigation.pathname = "/authorize";
    render(<PassportLogo />);
    act(() => pendingRequestPresence.publish(true));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    act(() => pendingRequestPresence.publish(false));
    expect(screen.getByRole("link", { name: "Pubky" })).toHaveAttribute("href", "/");
  });
});
