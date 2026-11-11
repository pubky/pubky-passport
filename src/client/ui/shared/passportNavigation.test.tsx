/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "./primitives/button";
import { PassportNavigation } from "./passportNavigation";

describe("PassportNavigation", () => {
  afterEach(cleanup);

  it("stacks Back above Confirm in one full-width column at every width", () => {
    render(<PassportNavigation back={<Button>Back</Button>} confirm={<Button>Confirm</Button>} />);

    const back = screen.getByRole("button", { name: "Back" }).parentElement;
    const confirm = screen.getByRole("button", { name: "Confirm" }).parentElement;
    expect(back?.parentElement).toBe(confirm?.parentElement);
    expect(back?.parentElement).toHaveClass("grid", "w-full", "grid-cols-1");
    expect(back?.parentElement?.className).not.toMatch(/md:/u);
    expect(back?.nextElementSibling).toBe(confirm);
    expect(back?.parentElement).not.toHaveClass("mt-auto");
  });
});
