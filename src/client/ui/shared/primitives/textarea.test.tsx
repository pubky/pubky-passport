/** @vitest-environment jsdom */

import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { Textarea } from "./textarea";

describe("Textarea", () => {
  afterEach(cleanup);

  it("takes text and forwards the field's state like Input", async () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(
      <>
        <Textarea aria-describedby="hint" aria-invalid aria-label="Bio" ref={ref} />
        <p id="hint">Up to 160 characters.</p>
      </>,
    );
    const bio = screen.getByRole("textbox", { name: "Bio" });
    expect(ref.current).toBe(bio);
    expect(bio).toHaveAccessibleDescription("Up to 160 characters.");
    expect(bio).toBeInvalid();
    await userEvent.setup().type(bio, "First line{Enter}second line");
    expect(bio).toHaveValue("First line\nsecond line");
  });

  it("is disabled with its form while the form is busy", () => {
    render(
      <fieldset disabled>
        <Textarea aria-label="Bio" />
      </fieldset>,
    );
    expect(screen.getByRole("textbox", { name: "Bio" })).toBeDisabled();
  });

  it("grows with its text where the browser can, and keeps the caller's classes", () => {
    render(<Textarea aria-label="Bio" className="border-dashed" />);
    // jsdom lays nothing out, so the sizing is checked by the one class that asks for it.
    expect(screen.getByRole("textbox", { name: "Bio" })).toHaveClass(
      "[field-sizing:content]",
      "border-dashed",
    );
  });
});
