/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmGoogleDetachment } from "./confirmGoogleDetachment";

describe("ConfirmGoogleDetachment", () => {
  afterEach(cleanup);

  it("requires the exact DELETE confirmation before detaching", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmGoogleDetachment canConfirm canRetryAuthorization={false} error={false} onCancel={vi.fn()} onConfirm={onConfirm} onRetryAuthorization={vi.fn()} open pending={false} />);

    const heading = await screen.findByRole("heading", { name: "Remove Google Access" });
    expect(heading).toBeInTheDocument();
    expect(heading.closest("dialog")).toHaveClass("max-w-none", "border", "sm:max-w-[375px]");
    expect(heading.closest("dialog")).not.toHaveClass("border-b-0");
    const confirm = screen.getByRole("button", { name: "Confirm deletion" });
    expect(confirm).toBeDisabled();
    await userEvent.setup().type(screen.getByLabelText("Type DELETE to confirm"), "delete");
    expect(confirm).toBeDisabled();
    await userEvent.setup().clear(screen.getByLabelText("Type DELETE to confirm"));
    await userEvent.setup().type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await userEvent.setup().click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("can be cancelled from either Figma control", async () => {
    const onCancel = vi.fn();
    render(<ConfirmGoogleDetachment canConfirm canRetryAuthorization={false} error={false} onCancel={onCancel} onConfirm={vi.fn()} onRetryAuthorization={vi.fn()} open pending={false} />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Close" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("retries Google initialization without closing the dialog", async () => {
    const onRetryAuthorization = vi.fn();
    render(<ConfirmGoogleDetachment canConfirm={false} canRetryAuthorization error onCancel={vi.fn()} onConfirm={vi.fn()} onRetryAuthorization={onRetryAuthorization} open pending={false} />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Try again" }));

    expect(onRetryAuthorization).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const confirmation = screen.getByLabelText("Type DELETE to confirm");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not connect to Google");
    expect(confirmation).not.toHaveAttribute("aria-invalid");
  });
});
