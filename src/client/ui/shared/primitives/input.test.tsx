/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Input } from "./input";

describe("Input", () => {
  afterEach(cleanup);

  it("applies native and container classes to their respective elements", () => {
    render(
      <Input aria-label="Identity" className="input-class" containerClassName="container-class" />,
    );

    const input = screen.getByRole("textbox", { name: "Identity" });
    expect(input).toHaveClass("input-class");
    expect(input).not.toHaveClass("container-class");
    expect(input.parentElement).toHaveClass("container-class");
    expect(input.parentElement).not.toHaveClass("input-class");
  });

  it("fills the field's height, so a tap anywhere across the field focuses it", () => {
    render(<Input aria-label="Authorization link" action={<button type="button">Paste</button>} />);

    expect(screen.getByRole("textbox", { name: "Authorization link" })).toHaveClass("self-stretch");
  });
});
