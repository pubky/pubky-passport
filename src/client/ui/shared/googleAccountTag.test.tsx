/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GoogleAccountTag } from "./googleAccountTag";

describe("GoogleAccountTag", () => {
  afterEach(cleanup);

  it("keeps the whole address readable, wrapping instead of cutting it", () => {
    const email = "alexandra.rivera-montgomery.work@customer-portal.example.com";
    render(<GoogleAccountTag account={{ email, pictureUrl: null }} />);

    const tag = screen.getByRole("group", { name: `Attached Google account: ${email}` });
    expect(tag).toHaveAttribute("title", email);
    const address = screen.getByText(email);
    expect(address).not.toHaveClass("truncate");
    expect(address).toHaveClass("[overflow-wrap:anywhere]");
  });
});
