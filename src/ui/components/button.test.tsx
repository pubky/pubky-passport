/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  afterEach(cleanup);

  it("renders the Figma default large variant", () => {
    render(
      <Button size="lg">
        <svg aria-hidden="true" />
        Continue
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toHaveClass(
      "h-[60px]",
      "gap-2",
      "rounded-full",
      "border-brand",
      "bg-brand/16",
      "px-8",
      "py-5",
      "text-brand",
      "shadow-xs",
      "[&_svg]:size-4",
    );
    expect(button).toHaveAttribute("data-size", "lg");
    expect(button).toHaveAttribute("data-variant", "default");
  });

  it("renders the Figma secondary large variant", () => {
    render(<Button size="lg" variant="secondary">Scan QR</Button>);

    expect(screen.getByRole("button", { name: "Scan QR" })).toHaveClass(
      "h-[60px]",
      "border-transparent",
      "bg-secondary",
      "text-secondary-foreground",
    );
  });

  it("renders the Figma destructive large variant", () => {
    render(<Button size="lg" variant="destructive">Remove Google Access</Button>);

    expect(screen.getByRole("button", { name: "Remove Google Access" })).toHaveClass(
      "h-[60px]",
      "border-transparent",
      "bg-destructive-surface",
      "text-destructive-foreground",
    );
  });

  it("renders the Figma outline large variant", () => {
    render(<Button size="lg" variant="outline">Cancel</Button>);

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass(
      "h-[60px]",
      "border-border",
      "bg-input-surface",
      "text-foreground",
    );
  });

  it("forwards its button ref", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Continue</Button>);

    expect(ref.current).toBe(screen.getByRole("button", { name: "Continue" }));
  });

  it("supports SHADCN composition through Slot", () => {
    render(<Button asChild><a href="/authorize">Authorize</a></Button>);

    expect(screen.getByRole("link", { name: "Authorize" })).toHaveAttribute("data-slot", "button");
  });
});
