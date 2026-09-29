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
    // Actions sit at the bottom, so cards side by side line them up.
    expect(button.parentElement).toHaveClass("mt-auto", "flex-col");
    // The concept's illustration is decoration, shown from lg.
    const image = container.querySelector('img[src*="keychain.png"]');
    expect(image).toHaveAttribute("aria-hidden", "true");
    expect(image).toHaveClass("hidden", "lg:block");
    // The card sizes its layout by its own width, so it fits the step column and a wide screen
    // alike: the illustration moves beside the text once the card is wide enough.
    expect(card).toHaveClass("@container");
    expect(image?.parentElement).toHaveClass("@xl:flex-row");
    expect(image?.parentElement).not.toHaveClass("xl:flex-row");
    // Beside the text the art and spacing shrink, so the actions' labels keep one line.
    expect(image).toHaveClass("size-48", "@xl:size-36");
    expect(image?.parentElement).toHaveClass("lg:p-8", "@xl:gap-8");
    expect(image?.parentElement).not.toHaveClass("xl:p-12");
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
