/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SetupProgress, SetupProgressProvider, SetupProgressSlot } from "./setupProgress";

/** The header row's slot, as the root layout renders it, before any screen. */
function renderSlot(): HTMLElement {
  render(<SetupProgressSlot />);
  return document.getElementById("passport-header-progress")!;
}

describe("SetupProgress", () => {
  afterEach(cleanup);

  it("renders nothing outside a setup flow", () => {
    const slot = renderSlot();
    const { container } = render(<SetupProgress />);
    expect(container).toBeEmptyDOMElement();
    expect(slot).toBeEmptyDOMElement();
  });

  it("renders nothing without the header's slot", () => {
    const { container } = render(
      <SetupProgressProvider current={1}>
        <SetupProgress />
      </SetupProgressProvider>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("marks completed, current and pending steps", () => {
    renderSlot();
    render(
      <SetupProgressProvider current={1}>
        <SetupProgress />
      </SetupProgressProvider>,
    );

    const progress = screen.getByRole("navigation", { name: "Account setup progress" });
    // Screen readers hear the step by number and name; the circles are only drawn.
    expect(screen.getByText("Step 2 of 3: Identity keys")).toHaveClass("sr-only");
    expect(within(progress).queryByRole("listitem")).not.toBeInTheDocument();
    const circles = progress.querySelectorAll("[data-state]");
    expect([...circles].map((circle) => circle.getAttribute("data-state"))).toEqual([
      "complete",
      "current",
      "pending",
    ]);
    expect(circles[0]?.closest("[aria-hidden='true']")).not.toBeNull();
    // A finished step shows a tick instead of its number.
    expect(circles[0]?.querySelector("svg")).not.toBeNull();
    expect(circles[0]).not.toHaveTextContent("1");
    expect(circles[1]).toHaveTextContent("2");
    expect(circles[2]).toHaveTextContent("3");
  });
});

describe("SetupProgress position", () => {
  afterEach(cleanup);

  it("shows in the header's slot, not where the screen renders it", () => {
    const slot = renderSlot();
    const { container } = render(
      <SetupProgressProvider current={0}>
        <SetupProgress />
      </SetupProgressProvider>,
    );

    const progress = screen.getByRole("navigation", { name: "Account setup progress" });
    expect(slot).toContainElement(progress);
    expect(container).not.toContainElement(progress);
  });

  it("fills the compact bar by the finished steps, with none before one is finished", () => {
    const slot = renderSlot();
    const { rerender } = render(
      <SetupProgressProvider current={0}>
        <SetupProgress />
      </SetupProgressProvider>,
    );
    expect(slot.querySelector("[style]")).toBeNull();

    rerender(
      <SetupProgressProvider current={2}>
        <SetupProgress />
      </SetupProgressProvider>,
    );
    const fill = slot.querySelector<HTMLElement>("[style]");
    expect(fill?.style.width).toMatch(/^66\.66/u);
    expect(fill?.parentElement).toHaveAttribute("aria-hidden", "true");
    expect(fill?.parentElement).toHaveClass("md:hidden");
  });
});
