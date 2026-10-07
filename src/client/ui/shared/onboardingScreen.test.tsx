/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingScreen } from "./onboardingScreen";

describe("OnboardingScreen", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens on its heading, accent in the brand colour, with its lead under it", () => {
    render(
      <OnboardingScreen
        accent="Pubky."
        lead="How would you like to create your pubky?"
        title="Let’s join"
      >
        <p>Cards</p>
      </OnboardingScreen>,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Let’s join Pubky." });
    expect(heading).toHaveFocus();
    expect(screen.getByText("Pubky.")).toHaveClass("text-brand");
    const lead = screen.getByText("How would you like to create your pubky?");
    expect(lead.tagName).toBe("P");
    expect(heading.parentElement).toContainElement(lead);
    expect(document.title).toBe("Let’s join Pubky | Pubky Passport");
  });

  it("shows a lead from md only when asked, as where a phone's frame has none", () => {
    render(
      <OnboardingScreen accent="Pubky." lead="From md" leadFrom="md" title="Let’s join">
        <p>Cards</p>
      </OnboardingScreen>,
    );
    expect(screen.getByText("From md")).toHaveClass("hidden", "md:block");
    cleanup();

    render(
      <OnboardingScreen accent="Pubky." lead="Always" title="Let’s join">
        <p>Cards</p>
      </OnboardingScreen>,
    );
    expect(screen.getByText("Always")).not.toHaveClass("hidden");
  });

  it("names the window by the title it is given over the heading's words", () => {
    render(
      <OnboardingScreen accent="to pay." title="Scan" windowTitle="Pay">
        <p>Invoice</p>
      </OnboardingScreen>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Scan to pay." })).toBeInTheDocument();
    expect(document.title).toBe("Pay | Pubky Passport");
  });

  it("pins actions that lead on after the content, in the container pinned on phones", () => {
    render(
      <OnboardingScreen
        accent="phone."
        actions={<button type="button">Send Code</button>}
        stickyActions
        title="Enter"
      >
        <p>Phone number field</p>
      </OnboardingScreen>,
    );

    const main = screen.getByRole("main");
    const actions = main.querySelector("[data-sticky-actions]");
    expect(actions).toContainElement(screen.getByRole("button", { name: "Send Code" }));
    expect(main.lastElementChild).toBe(actions);
    expect(actions).toHaveClass("sticky", "bottom-0", "md:static");
    // The screen fills a phone's window, so the actions sit at its bottom edge.
    expect(main.className).toMatch(/max-md:min-h-/u);
  });

  it("keeps a Back-only action in the flow, right after the content, with the footer last", () => {
    render(
      <OnboardingScreen
        accent="Pubky."
        actions={<button type="button">Back</button>}
        title="Let’s join"
      >
        <p>Join cards</p>
      </OnboardingScreen>,
    );

    const main = screen.getByRole("main");
    const back = screen.getByRole("button", { name: "Back" });
    expect(main.querySelector("[data-sticky-actions]")).toBeNull();
    expect(main.lastElementChild).toContainElement(back);
    expect(main.lastElementChild?.className ?? "").not.toMatch(/sticky/u);
    // Nothing stretches the screen to the window: the page footer follows the content.
    expect(main.className).not.toMatch(/max-md:min-h-/u);
  });

  it("leaves the page footer to follow the content when there are no actions", () => {
    render(
      <OnboardingScreen accent="keychain." title="Pick your">
        <p>Keychain card</p>
      </OnboardingScreen>,
    );

    const main = screen.getByRole("main");
    expect(main.querySelector("[data-sticky-actions]")).toBeNull();
    expect(main.className).not.toMatch(/max-md:min-h-/u);
  });
});
