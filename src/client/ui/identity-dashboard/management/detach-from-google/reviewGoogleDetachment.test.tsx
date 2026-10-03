/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReviewGoogleDetachment } from "./reviewGoogleDetachment";

describe("ReviewGoogleDetachment", () => {
  afterEach(cleanup);

  it("names what detaching keeps and gates confirmation behind Detach from Google", async () => {
    const onBack = vi.fn();
    const onRemove = vi.fn();
    const { container } = render(
      <ReviewGoogleDetachment
        googleAccount={{ email: "alex@example.com", pictureUrl: null }}
        onBack={onBack}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByRole("heading", { name: "Detach from Google." })).toBeInTheDocument();
    expect(
      screen.getByText(
        "You are about to remove this Google account as a way to access your pubky:",
      ),
    ).toBeInTheDocument();
    // People with several Google accounts see which one holds this backup: at body size, not as
    // the small chip the lists use.
    const account = screen.getByRole("group", {
      name: "Attached Google account: alex@example.com",
    });
    expect(account).toBeVisible();
    expect(account).not.toHaveClass("text-xs", "border");
    expect(screen.getByText("alex@example.com")).toHaveClass("text-sm");
    expect(screen.getByText(/You’ll stay signed in on this device/)).toBeInTheDocument();
    const redLine = container.querySelector('img[src$="red-line.svg"]');
    expect(redLine).toHaveClass("h-auto");
    expect(redLine).toHaveAttribute("width", "282");
    expect(redLine).toHaveAttribute("height", "8");

    await userEvent.setup().click(screen.getByRole("button", { name: "Detach from Google" }));
    expect(onRemove).toHaveBeenCalledOnce();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows the account's picture large enough to recognise", () => {
    render(
      <ReviewGoogleDetachment
        googleAccount={{
          email: "alex@example.com",
          pictureUrl: "https://lh3.googleusercontent.com/a/photo",
        }}
        onBack={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    const picture = screen.getByTestId("google-account-tag-picture");
    expect(picture).toHaveAttribute("src", "https://lh3.googleusercontent.com/a/photo");
    expect(picture.parentElement).toHaveClass("size-10", "rounded-full");
  });
});
