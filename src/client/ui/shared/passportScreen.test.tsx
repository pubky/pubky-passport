/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PassportScreen } from "./passportScreen";
import { DisplayHeading } from "./primitives/typography";
import { SetupProgressProvider, SetupProgressSlot } from "./setupProgress";

describe("PassportScreen", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("moves focus to the new screen's heading and scrolls to the top", () => {
    render(
      <PassportScreen>
        <DisplayHeading accent="pubky." aria-label="Your pubky.">
          Your{" "}
        </DisplayHeading>
        <button type="button">Continue</button>
      </PassportScreen>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Your pubky." })).toHaveFocus();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });

  it("focuses the screen itself when it has no heading that takes focus", () => {
    render(
      <PassportScreen>
        <h1>Plain heading</h1>
        <button type="button">Continue</button>
      </PassportScreen>,
    );

    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("names the window after the heading and follows it until the screen goes", async () => {
    function Step({ accent }: { accent: string }) {
      return (
        <PassportScreen>
          <DisplayHeading accent={accent}>Enter </DisplayHeading>
        </PassportScreen>
      );
    }
    const { rerender, unmount } = render(<Step accent="Code." />);
    expect(document.title).toBe("Enter Code | Pubky Passport");

    rerender(<Step accent="Invite." />);
    await waitFor(() => expect(document.title).toBe("Enter Invite | Pubky Passport"));

    // A title the layout sets later (its metadata streams in) does not replace the step's.
    document.title = "Pubky Passport";
    await waitFor(() => expect(document.title).toBe("Enter Invite | Pubky Passport"));

    unmount();
    expect(document.title).toBe("Pubky Passport");
  });

  it("prefers a window title the heading gives over its accessible name", () => {
    render(
      <PassportScreen>
        <DisplayHeading
          accent="Google"
          aria-label="Signing in to Google"
          data-window-title="Signing in to Google (evil.example)"
        >
          Signing in to
        </DisplayHeading>
      </PassportScreen>,
    );

    expect(document.title).toBe("Signing in to Google (evil.example) | Pubky Passport");
  });

  it("keeps focus on a field the screen focuses itself", () => {
    render(
      <PassportScreen>
        <label>
          Invite code
          <input autoFocus />
        </label>
      </PassportScreen>,
    );

    expect(screen.getByLabelText("Invite code")).toHaveFocus();
    expect(window.scrollTo).toHaveBeenCalledOnce();
  });

  it("shows setup progress only inside a setup flow", () => {
    render(<PassportScreen>Content</PassportScreen>);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();

    cleanup();
    // The progress shows in the header's slot, which the root layout renders above every screen.
    render(<SetupProgressSlot />);
    render(
      <SetupProgressProvider current={1}>
        <PassportScreen>Content</PassportScreen>
      </SetupProgressProvider>,
    );
    const progress = screen.getByRole("navigation", { name: "Account setup progress" });
    expect(document.getElementById("passport-header-progress")).toContainElement(progress);
    expect(screen.getByRole("main")).not.toContainElement(progress);
  });
});
