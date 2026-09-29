/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleDrivePermissionPrompt, GooglePermissionGuide } from "./googleDrivePermissionPrompt";

const STILL = "/illustrations/google-drive-permissions-still.png";
const ANIMATION = "/illustrations/google-drive-permissions.gif";
const CAPTION = "In Google’s window, tick Select all (or both Drive boxes), then press Continue.";

afterEach(cleanup);

describe("GooglePermissionGuide", () => {
  it("shows a still, captioned illustration until the person plays the animation", async () => {
    render(<GooglePermissionGuide />);

    const figure = screen.getByRole("figure");
    expect(within(figure).getByText(CAPTION).tagName).toBe("FIGCAPTION");
    const still = within(figure).getByRole("img", { name: /both Google Drive boxes ticked/ });
    expect(still).toHaveAttribute("src", STILL);
    // Cropped above Google's own Cancel and Continue, so they are not taken for Passport's.
    expect(still).toHaveClass("aspect-[960/640]", "object-cover", "object-top");
    expect(within(figure).queryByRole("img", { name: /^Animation/ })).not.toBeInTheDocument();
    expect(still.parentElement).toHaveClass(
      "rounded-2xl",
      "ring-1",
      "ring-border",
      "max-w-[480px]",
    );

    const user = userEvent.setup();
    await user.click(within(figure).getByRole("button", { name: "Play animation" }));
    const animation = within(figure).getByRole("img", { name: /^Animation/ });
    expect(animation).toHaveAttribute("src", ANIMATION);
    // Reduced motion keeps the still even while playing.
    expect(animation).toHaveClass("motion-reduce:hidden");
    expect(still).toHaveClass("hidden", "motion-reduce:block");

    await user.click(within(figure).getByRole("button", { name: "Pause animation" }));
    expect(within(figure).queryByRole("img", { name: /^Animation/ })).not.toBeInTheDocument();
    expect(still).not.toHaveClass("hidden");
  });

  it("offers no animation with reduced motion and takes a shorter caption", () => {
    render(<GooglePermissionGuide caption="What to tick in Google’s window" compact />);

    const figure = screen.getByRole("figure");
    expect(within(figure).getByRole("button", { name: "Play animation" })).toHaveClass(
      "motion-reduce:hidden",
      "min-h-11",
    );
    expect(within(figure).getByText("What to tick in Google’s window").tagName).toBe("FIGCAPTION");
    expect(figure).not.toHaveTextContent(CAPTION);
    expect(within(figure).getByRole("img").parentElement).toHaveClass("max-w-[360px]");
  });
});

describe("GoogleDrivePermissionPrompt", () => {
  it("puts the guide after every action, so focus reaches the actions first", async () => {
    const onBack = vi.fn();
    const onContinue = vi.fn();
    const onTryAgain = vi.fn();
    render(
      <GoogleDrivePermissionPrompt
        mode="optional"
        onBack={onBack}
        onContinue={onContinue}
        onTryAgain={onTryAgain}
      />,
    );

    expect(screen.getByRole("heading", { name: "Drive access optional." })).toHaveFocus();
    expect(screen.getByRole("figure")).toHaveTextContent(CAPTION);
    // One DOM order at every width: no CSS reordering that the focus order would not follow.
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Back",
      "Try again",
      "Continue without visible backup",
      "Play",
    ]);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole("button", { name: "Back" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Continue without visible backup" }));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(onTryAgain).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
