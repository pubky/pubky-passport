/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Button, ButtonLink } from "./button";

describe("Button", () => {
  afterEach(cleanup);

  it("renders a native button and forwards its ref", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button disabled ref={ref}>Continue</Button>);

    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("type", "button");
    expect(ref.current).toBe(button);
  });

  it("renders an anchor and forwards its anchor ref", () => {
    const ref = createRef<HTMLAnchorElement>();
    render(<ButtonLink href="/authorize" ref={ref}>Authorize</ButtonLink>);

    const link = screen.getByRole("link", { name: "Authorize" });
    expect(link).toHaveAttribute("href", "/authorize");
    expect(ref.current).toBe(link);
  });
});
