/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("shows the round Google picture, then the address, with no Google mark", () => {
    const { container } = render(
      <GoogleAccountTag
        account={{
          email: "al@example.com",
          pictureUrl: "https://lh3.googleusercontent.com/a/photo",
        }}
      />,
    );

    const picture = screen.getByTestId("google-account-tag-picture");
    expect(picture).toHaveAttribute("src", "https://lh3.googleusercontent.com/a/photo");
    expect(picture).toHaveAttribute("alt", "");
    expect(picture.parentElement).toHaveClass("rounded-full");
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByRole("group")).toHaveTextContent(/^al@example\.com$/u);
  });

  it("leaves the picture out when the account has none or it fails to load", () => {
    const { container, rerender } = render(
      <GoogleAccountTag account={{ email: "al@example.com" }} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();

    rerender(
      <GoogleAccountTag
        account={{ email: "al@example.com", pictureUrl: "https://lh3.googleusercontent.com/a/x" }}
      />,
    );
    fireEvent.error(screen.getByTestId("google-account-tag-picture"));
    expect(container.querySelector("img")).toBeNull();
  });
});
