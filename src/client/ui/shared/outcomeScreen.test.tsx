/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OutcomeScreen } from "./outcomeScreen";
import { Button } from "./primitives/button";

describe("OutcomeScreen", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the heading, what changed, the details, the checkmark and the way on, in order", () => {
    const { container } = render(
      <OutcomeScreen
        accent="attached."
        action={<Button className="w-full">Done</Button>}
        description="You can now sign in with Google."
        label="Google account attached."
        title="Google account"
      >
        <p>alex@example.com</p>
      </OutcomeScreen>,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Google account attached." });
    expect(heading).toHaveClass(
      "text-[length:clamp(1.75rem,calc((100vw_-_3rem)/6.4),3rem)]",
      "md:text-6xl",
    );
    const lead = screen.getByText("You can now sign in with Google.");
    const detail = screen.getByText("alex@example.com");
    const checkmark = container.querySelector('img[src*="checkmark.png"]');
    const done = screen.getByRole("button", { name: "Done" });
    expect(checkmark).toHaveAttribute("aria-hidden", "true");
    const order = [heading, lead, detail, checkmark!, done];
    for (let index = 1; index < order.length; index++)
      expect(
        order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    // On a phone the way on sits at the bottom of the screen; from md at the track's end.
    expect(done.parentElement).toHaveClass("md:col-start-3");
    expect(done.parentElement?.parentElement).toHaveClass("mt-auto", "md:mt-0");
    // From md the checkmark sits centred in a card across the track.
    expect(checkmark?.parentElement).toHaveClass("justify-center", "md:bg-card", "md:p-12");
  });
});
