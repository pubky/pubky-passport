/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DRIVE_PERMISSION_HINT } from "@/client/ui/googleDrivePermissionPrompt";
import { ConfirmGoogleDetachment } from "./confirmGoogleDetachment";

describe("ConfirmGoogleDetachment", () => {
  afterEach(cleanup);

  it("requires the confirmation word, in any case, before detaching", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmGoogleDetachment
        canConfirm
        canRetryAuthorization={false}
        error={null}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        onRetryAuthorization={vi.fn()}
        open
        pending={false}
      />,
    );

    const heading = await screen.findByRole("heading", { name: "Remove Google Access" });
    expect(heading).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      `${DRIVE_PERMISSION_HINT} Passport needs both to delete your backup and its visible copies.`,
    );
    const confirm = screen.getByRole("button", { name: "Confirm detachment" });
    expect(confirm).toBeDisabled();
    expect(screen.getByText("DETACH")).toHaveClass("text-white");
    await userEvent.setup().type(screen.getByLabelText("Type DETACH to confirm"), "detac");
    expect(confirm).toBeDisabled();
    await userEvent.setup().clear(screen.getByLabelText("Type DETACH to confirm"));
    // The word counts, not how a phone keyboard capitalised or spaced it.
    await userEvent.setup().type(screen.getByLabelText("Type DETACH to confirm"), "Detach ");
    await userEvent.setup().click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("can be cancelled from either close control", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmGoogleDetachment
        canConfirm
        canRetryAuthorization={false}
        error={null}
        onCancel={onCancel}
        onConfirm={vi.fn()}
        onRetryAuthorization={vi.fn()}
        open
        pending={false}
      />,
    );

    await userEvent.setup().click(await screen.findByRole("button", { name: "Close" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("retries Google initialization without closing the dialog", async () => {
    const onRetryAuthorization = vi.fn();
    render(
      <ConfirmGoogleDetachment
        canConfirm={false}
        canRetryAuthorization
        error={{ code: "authorization_failed" }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onRetryAuthorization={onRetryAuthorization}
        open
        pending={false}
      />,
    );

    await userEvent.setup().click(await screen.findByRole("button", { name: "Try again" }));

    expect(onRetryAuthorization).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const confirmation = screen.getByLabelText("Type DETACH to confirm");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not connect to Google");
    expect(confirmation).not.toHaveAttribute("aria-invalid");
  });

  it("shows user copy and keeps the safe error code in collapsed technical details", async () => {
    render(
      <ConfirmGoogleDetachment
        canConfirm
        canRetryAuthorization={false}
        error={{ code: "google_drive_cleanup_failed" }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onRetryAuthorization={vi.fn()}
        open
        pending={false}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not remove Google access. Please try again.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("google_drive_cleanup_failed");
    const details = screen.getByText("Technical details").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(within(details!).getByText("google_drive_cleanup_failed")).toBeInTheDocument();
  });

  it("keeps focus on the busy confirm button and then moves it to a new failure", async () => {
    const props = {
      canConfirm: true,
      canRetryAuthorization: false,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
      onRetryAuthorization: vi.fn(),
      open: true,
    };
    const { rerender } = render(<ConfirmGoogleDetachment {...props} error={null} pending />);

    const confirm = await screen.findByRole("button", { name: "Removing…" });
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(confirm).toBeEnabled();
    expect(screen.getByLabelText("Type DETACH to confirm")).toHaveAttribute("readonly");

    rerender(
      <ConfirmGoogleDetachment
        {...props}
        error={{ code: "google_drive_cleanup_failed" }}
        pending={false}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText("Type DETACH to confirm")).toHaveAccessibleDescription(
      "Could not remove Google access. Please try again.",
    );
  });
});
