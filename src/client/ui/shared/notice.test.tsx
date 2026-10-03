/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Notice } from "./notice";

describe("Notice", () => {
  afterEach(cleanup);

  it("announces an error as an alert with a readable red icon", () => {
    render(<Notice tone="error">Could not save your profile.</Notice>);

    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("Could not save your profile.");
    expect(notice).toHaveClass(
      "border-destructive-text/40",
      "bg-destructive/10",
      "text-foreground",
    );
    const icon = notice.querySelector('[data-slot="icon"]');
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveClass("text-destructive-text");
  });

  it.each([
    ["warning", "border-warning/40", "text-warning"],
    ["info", "border-border", "text-muted-foreground"],
  ] as const)("announces a %s politely as a status", (tone, border, iconColor) => {
    render(<Notice tone={tone}>Read this first.</Notice>);

    const notice = screen.getByRole("status");
    expect(notice).toHaveClass(border);
    expect(notice.querySelector('[data-slot="icon"]')).toHaveClass(iconColor);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a caller's role, so a warning can still interrupt", () => {
    render(
      <Notice role="alert" tone="warning">
        Broad access.
      </Notice>,
    );

    expect(screen.getByRole("alert")).toHaveAttribute("data-tone", "warning");
  });

  it("takes focus when asked, so a failure is read out and Tab continues from it", () => {
    render(
      <>
        <button type="button">Submit</button>
        <Notice focusOnMount tone="error">
          The password is wrong.
        </Notice>
      </>,
    );

    const notice = screen.getByRole("alert");
    expect(notice).toHaveFocus();
    expect(notice).toHaveAttribute("tabindex", "-1");
  });

  it("leaves focus alone by default", () => {
    render(<Notice tone="error">Background failure.</Notice>);

    expect(screen.getByRole("alert")).not.toHaveFocus();
    expect(screen.getByRole("alert")).not.toHaveAttribute("tabindex");
  });

  it("lays out actions under the message", () => {
    render(
      <Notice tone="error">
        Payment has not been confirmed yet.
        <button type="button">Use an invite code</button>
      </Notice>,
    );

    expect(
      screen
        .getByRole("alert")
        .contains(screen.getByRole("button", { name: "Use an invite code" })),
    ).toBe(true);
  });
});
