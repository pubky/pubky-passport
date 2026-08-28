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
});
