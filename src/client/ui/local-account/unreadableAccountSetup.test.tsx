/** @vitest-environment jsdom */

import { Result } from "better-result";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UnreadableAccountSetup } from "./unreadableAccountSetup";

describe("UnreadableAccountSetup", () => {
  afterEach(cleanup);

  it("removes the unreadable setup only after typed confirmation", async () => {
    const removeSetup = vi
      .fn()
      .mockReturnValueOnce(Result.err({ code: "storage_unavailable" }))
      .mockReturnValueOnce(Result.ok());
    const onBack = vi.fn();
    render(<UnreadableAccountSetup removable onBack={onBack} removeSetup={removeSetup} />);
    const user = userEvent.setup();

    // The only way on from a damaged record is a real button, not a quiet text action.
    const remove = screen.getByRole("button", { name: "Remove saved setup…" });
    expect(remove).toHaveClass("bg-secondary");
    expect(screen.getByRole("heading", { name: "Setup unavailable." })).toHaveAccessibleDescription(
      /is damaged, so Passport can’t continue it\. To start again, remove the saved setup/u,
    );
    await user.click(remove);
    expect(screen.getByText(/Without its recovery file/u)).toBeVisible();
    const confirm = screen.getByRole("button", { name: "Remove key and setup" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Type DELETE to confirm" }), "DELETE");
    await user.click(confirm);
    expect(screen.getByText(/this browser blocked the change/u)).toBeVisible();
    expect(onBack).not.toHaveBeenCalled();

    await user.click(confirm);
    expect(removeSetup).toHaveBeenCalledTimes(2);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("keeps the setup when the person cancels or goes back", async () => {
    const removeSetup = vi.fn();
    const onBack = vi.fn();
    render(<UnreadableAccountSetup removable onBack={onBack} removeSetup={removeSetup} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove saved setup…" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(removeSetup).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("offers no removal when browser storage itself is unavailable, and names the cause", () => {
    render(<UnreadableAccountSetup removable={false} onBack={vi.fn()} />);
    const heading = screen.getByRole("heading", { name: /Setup unavailable/u });
    // Blocked storage, not a damaged record: removing it cannot help, allowing site data can.
    expect(heading).toHaveAccessibleDescription(
      /can’t read this browser’s storage.*Allow site data for this site, then go back and choose Create account again\./u,
    );
    expect(heading).not.toHaveAccessibleDescription(/Go back and try again/u);
    expect(screen.queryByRole("button", { name: /Remove saved setup/u })).not.toBeInTheDocument();
  });
});
