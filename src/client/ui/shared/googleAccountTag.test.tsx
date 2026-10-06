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

  it("shows a picture large enough to recognise and the address at body size when large", () => {
    const email = "al@example.com";
    const { container, rerender } = render(
      <GoogleAccountTag
        account={{ email, pictureUrl: "https://lh3.googleusercontent.com/a/photo" }}
        size="lg"
      />,
    );

    const tag = screen.getByRole("group", { name: `Attached Google account: ${email}` });
    const picture = screen.getByTestId("google-account-tag-picture");
    expect(picture.parentElement).toHaveClass("size-10", "rounded-full");
    expect(screen.getByText(email)).toHaveClass("text-sm", "[overflow-wrap:anywhere]");
    // Not the chip: no pill surface around the account.
    expect(tag).not.toHaveClass("border", "text-xs");
    expect(container.querySelector("svg")).toBeNull();

    // Without a picture, or with one that fails to load, only the address shows.
    fireEvent.error(picture);
    expect(container.querySelector("img")).toBeNull();
    rerender(<GoogleAccountTag account={{ email }} size="lg" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("group")).toHaveTextContent(/^al@example\.com$/u);
  });

  it("keeps the chip's small picture by default", () => {
    render(
      <GoogleAccountTag
        account={{ email: "al@example.com", pictureUrl: "https://lh3.googleusercontent.com/a/x" }}
      />,
    );
    expect(screen.getByTestId("google-account-tag-picture").parentElement).toHaveClass("size-4");
    expect(screen.getByRole("group")).toHaveClass("text-xs", "border");
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
