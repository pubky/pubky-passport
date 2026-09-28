/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PassportScreen } from "./passportScreen";
import { SetupProgressProvider } from "./setupProgress";

describe("PassportScreen", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("moves focus to the new screen and scrolls to the top", () => {
    render(
      <PassportScreen>
        <button type="button">Continue</button>
      </PassportScreen>,
    );

    expect(screen.getByRole("main")).toHaveFocus();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
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
    render(
      <SetupProgressProvider steps={["Account", "Keys", "Profile"]} current={1}>
        <PassportScreen>Content</PassportScreen>
      </SetupProgressProvider>,
    );
    expect(screen.getByRole("main")).toContainElement(
      screen.getByRole("navigation", { name: "Account setup progress" }),
    );
  });
});
