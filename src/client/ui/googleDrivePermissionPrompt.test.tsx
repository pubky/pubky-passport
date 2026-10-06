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
  it("always plays the animation and shows the still only with reduced motion", () => {
    render(<GooglePermissionGuide />);

    const figure = screen.getByRole("figure");
    expect(within(figure).getByText(CAPTION).tagName).toBe("FIGCAPTION");
    // No Play or Pause control: the animation plays on its own.
    expect(within(figure).queryByRole("button")).not.toBeInTheDocument();
    const animation = within(figure).getByRole("img", { name: /^Animation/ });
    expect(animation).toHaveAttribute("src", ANIMATION);
    expect(animation).toHaveClass("motion-reduce:hidden");
    const still = within(figure).getByRole("img", { name: /both Google Drive boxes ticked/ });
    expect(still).toHaveAttribute("src", STILL);
    expect(still).toHaveClass("hidden", "motion-reduce:block");
    // Cropped above Google's own Cancel and Continue, so they are not taken for Passport's.
    expect(still).toHaveClass("aspect-[960/640]", "object-cover", "object-top");
    expect(still.parentElement).toHaveClass(
      "rounded-2xl",
      "ring-1",
      "ring-border",
      "max-w-[480px]",
    );
  });

  it("shows no caption where the screen gives the instruction, only a name, in a narrower frame", () => {
    render(<GooglePermissionGuide compact label="What to tick in Google’s window" />);

    // The picture keeps a name for assistive technology, without visible text.
    const figure = screen.getByRole("figure", { name: "What to tick in Google’s window" });
    expect(figure.querySelector("figcaption")).toBeNull();
    expect(screen.queryByText("What to tick in Google’s window")).toBeNull();
    expect(figure).not.toHaveTextContent(CAPTION);
    expect(within(figure).getAllByRole("img")[0]?.parentElement).toHaveClass("max-w-[360px]");
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
      "Skip the folder copy",
    ]);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole("button", { name: "Back" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Skip the folder copy" }));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(onTryAgain).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
