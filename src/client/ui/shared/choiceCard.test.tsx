/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChoiceCard } from "./choiceCard";
import { Button } from "./primitives/button";

describe("ChoiceCard", () => {
  afterEach(cleanup);

  it("names the card by its heading and stacks its actions at full width", () => {
    const { container } = render(
      <ChoiceCard
        description="Keep your key on your phone."
        illustration="/illustrations/keychain.png"
        recommendationId="ring-recommended"
        title="Pubky Ring app"
      >
        <Button aria-describedby="ring-recommended" className="w-full">
          Keep key in Pubky Ring
        </Button>
      </ChoiceCard>,
    );

    const card = screen.getByRole("region", { name: "Pubky Ring app" });
    expect(card).toHaveTextContent("Keep your key on your phone.");
    const button = screen.getByRole("button", { name: "Keep key in Pubky Ring" });
    expect(button).toHaveAccessibleDescription("Recommended");
    // The actions follow the description in one stack, as on pubky.app.
    expect(button.parentElement).toHaveClass("flex-col");
    expect(button.parentElement).not.toHaveClass("mt-auto");
    // The concept's illustration is decoration, shown from lg in a left column of its own,
    // top-aligned with the heading.
    const image = container.querySelector('img[src*="keychain.png"]');
    expect(image).toHaveAttribute("aria-hidden", "true");
    expect(image).toHaveClass("hidden", "lg:block", "self-start", "shrink-0");
    expect(image?.parentElement).toHaveClass("flex");
    expect(image?.parentElement).not.toHaveClass("flex-col");
    expect(image?.nextElementSibling).toContainElement(screen.getByRole("heading"));
    // The card sizes the column by its own width, so it fits a half of a 1024px window and the
    // step column alike.
    expect(card).toHaveClass("@container");
    expect(image).toHaveClass("size-24", "@xl:size-36");
    // The spacing grows with the card, as the art does.
    expect(image?.parentElement).toHaveClass("lg:p-8", "@xl:gap-8");
    expect(image?.parentElement).not.toHaveClass("xl:p-12");
    // Corners as pubky.app's cards have them.
    expect(card).toHaveClass("rounded-md");
    expect(card).not.toHaveClass("rounded-lg");
  });

  it("gives the start page's pair a large illustration, about half the card, 48px from the content", () => {
    const { container } = render(
      <ChoiceCard
        dense
        description="Sign in with the key you keep in Pubky Ring."
        illustration="/illustrations/scan.png"
        split
        title="Pubky Ring"
      >
        <Button className="w-full">Sign in with Pubky Ring</Button>
      </ChoiceCard>,
    );

    const image = container.querySelector('img[src*="scan.png"]');
    // What the 18rem content column (no button label wraps in it) leaves of the card: 204px in
    // a 588px card, never more than 16rem; a 1024px window's half keeps the small one.
    expect(image).toHaveClass("size-24", "@xl:size-[min(16rem,calc(100cqw-24rem))]");
    expect(image).not.toHaveClass("@xl:size-36");
    expect(image?.parentElement).toHaveClass("p-6", "@xl:gap-12");
    expect(image?.parentElement).not.toHaveClass("@xl:gap-8", "lg:p-8");
    // Drawn from a source large enough for its size.
    expect(image).toHaveAttribute("width", "256");
  });

  it("shows no chip on an option that is not recommended", () => {
    render(
      <ChoiceCard
        description="Passport keeps your key in this browser."
        illustration="/illustrations/backup-shield.png"
        title="This browser"
      >
        <Button>Keep key in this browser</Button>
      </ChoiceCard>,
    );

    expect(screen.queryByText("Recommended")).toBeNull();
  });
});
