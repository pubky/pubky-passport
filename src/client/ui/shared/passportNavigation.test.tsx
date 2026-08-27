/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "./primitives/button";
import { PassportNavigation } from "./passportNavigation";

describe("PassportNavigation", () => {
  afterEach(cleanup);

  it("keeps a lone back action in the fixed left desktop column", () => {
    render(<PassportNavigation back={<Button>Back</Button>} />);

    const slot = screen.getByRole("button", { name: "Back" }).parentElement;
    expect(slot).toHaveClass("md:col-start-1");
    expect(slot?.parentElement).toHaveClass("w-full", "md:grid-cols-[120px_1fr_228px]");
    expect(slot?.parentElement).not.toHaveClass("mt-auto");
  });

  it("keeps a lone confirm action in the fixed right desktop column", () => {
    render(<PassportNavigation confirm={<Button>Confirm</Button>} />);

    const slot = screen.getByRole("button", { name: "Confirm" }).parentElement;
    expect(slot).toHaveClass("md:col-start-3");
    expect(slot?.parentElement).toHaveClass("w-full", "md:grid-cols-[120px_1fr_228px]");
  });
});
