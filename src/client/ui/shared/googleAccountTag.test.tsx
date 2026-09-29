/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GoogleAccountTag } from "./googleAccountTag";

describe("GoogleAccountTag", () => {
  afterEach(cleanup);

  it("keeps the whole address readable, wrapping instead of cutting it", () => {
    const email = "alexandra.rivera-montgomery.work@customer-portal.example.com";
    render(<GoogleAccountTag account={{ email }} />);

    const tag = screen.getByRole("group", { name: `Attached Google account: ${email}` });
    expect(tag).toHaveAttribute("title", email);
    const address = screen.getByText(email);
    expect(address).not.toHaveClass("truncate");
    expect(address).toHaveClass("[overflow-wrap:anywhere]");
  });

  it("leads with a legible Google mark and never shows the Google picture or its initials", () => {
    const { container } = render(
      <GoogleAccountTag
        account={
          {
            email: "al@example.com",
            pictureUrl: "https://lh3.googleusercontent.com/a/photo",
          } as { email: string }
        }
      />,
    );

    const mark = container.querySelector("svg");
    expect(mark).toHaveClass("size-3.5");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("group")).toHaveTextContent(/^al@example\.com$/u);
  });
});
