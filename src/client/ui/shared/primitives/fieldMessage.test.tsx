/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FieldMessage } from "./fieldMessage";

describe("FieldMessage", () => {
  afterEach(cleanup);

  it("keeps a hint small, muted and without an icon", () => {
    render(<FieldMessage id="hint">Minimum 12 characters.</FieldMessage>);

    const hint = screen.getByText("Minimum 12 characters.");
    expect(hint).toHaveClass("text-xs", "text-muted-foreground");
    expect(hint).not.toHaveAttribute("role");
    expect(hint.querySelector('[data-slot="icon"]')).toBeNull();
  });

  it("shows an error in the readable red with an alert icon, so colour is not the only cue", () => {
    render(<FieldMessage error>Passwords do not match.</FieldMessage>);

    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("Passwords do not match.");
    // destructive-foreground is near-white text for red surfaces, not error text on the page.
    expect(error).toHaveClass("text-destructive-text");
    expect(error).not.toHaveClass("text-destructive-foreground");
    expect(error.querySelector('[data-slot="icon"]')).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps inline markup in an error's sentence rather than splitting it into flex columns", () => {
    render(
      <FieldMessage error>
        Use <strong>12 or more</strong> characters.
      </FieldMessage>,
    );

    const error = screen.getByRole("alert");
    // The icon and one text wrapper are the only flex items.
    expect(error.children).toHaveLength(2);
    expect(error.children[1]).toHaveTextContent("Use 12 or more characters.");
    expect(error.children[1]).toContainElement(screen.getByText("12 or more"));
  });
});
