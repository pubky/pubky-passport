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

    await user.click(screen.getByRole("button", { name: "Remove saved setup" }));
    expect(screen.getByText(/may already own an account/u)).toBeVisible();
    const confirm = screen.getByRole("button", { name: "Remove key and setup" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Type DELETE to confirm" }), "DELETE");
    await user.click(confirm);
    expect(screen.getByText(/could not remove the saved setup/u)).toBeVisible();
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
    await user.click(screen.getByRole("button", { name: "Remove saved setup" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(removeSetup).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("offers no removal when browser storage itself is unavailable", () => {
    render(<UnreadableAccountSetup removable={false} onBack={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /Setup unavailable/u })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove saved setup" })).not.toBeInTheDocument();
  });
});
