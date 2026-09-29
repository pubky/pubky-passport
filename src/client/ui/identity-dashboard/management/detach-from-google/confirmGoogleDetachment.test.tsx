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
        email="alex@example.com"
        error={null}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        onRetryAuthorization={vi.fn()}
        onlyCopy={false}
        open
        pending={false}
      />,
    );

    const heading = await screen.findByRole("heading", { name: "Detach from Google?" });
    expect(heading).toBeInTheDocument();
    // Names the account to choose in Google's window, for people with several.
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      `Google’s window will open: sign in as alex@example.com. ${DRIVE_PERMISSION_HINT} Passport needs both to delete the encrypted backup and its copy in your “Pubky Passport” folder. You stay signed in on this device.`,
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

  // D-57: without a checked recovery file, the word typed is the acknowledgement itself.
  it("asks for ONLY COPY when no recovery file was checked, and nothing else will do", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmGoogleDetachment
        canConfirm
        canRetryAuthorization={false}
        email="alex@example.com"
        error={null}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        onRetryAuthorization={vi.fn()}
        onlyCopy
        open
        pending={false}
      />,
    );

    expect(
      await screen.findByRole("dialog", { name: "Detach from Google?" }),
    ).toHaveAccessibleDescription(
      `No recovery file of this key has been checked, so this browser will keep the only copy of your key. If its data is cleared, this pubky is gone unless it is in Pubky Ring. Google’s window will open: sign in as alex@example.com. ${DRIVE_PERMISSION_HINT} Passport needs both to delete the encrypted backup and its copy in your “Pubky Passport” folder. You stay signed in on this device.`,
    );
    expect(screen.queryByLabelText("Type DETACH to confirm")).not.toBeInTheDocument();
    const acknowledgement = screen.getByLabelText("Type ONLY COPY to confirm");
    const confirm = screen.getByRole("button", { name: "Confirm detachment" });
    for (const wrong of ["DETACH", "ONLY", "ONLYCOPY", "only copies"]) {
      await user.clear(acknowledgement);
      await user.type(acknowledgement, wrong);
      expect(confirm).toBeDisabled();
      await user.type(acknowledgement, "{Enter}");
    }
    expect(onConfirm).not.toHaveBeenCalled();

    await user.clear(acknowledgement);
    await user.type(acknowledgement, "Only copy ");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("can be cancelled from either close control", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmGoogleDetachment
        canConfirm
        canRetryAuthorization={false}
        email="alex@example.com"
        error={null}
        onCancel={onCancel}
        onConfirm={vi.fn()}
        onRetryAuthorization={vi.fn()}
        onlyCopy={false}
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
        email="alex@example.com"
        error={{ code: "authorization_failed" }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onRetryAuthorization={onRetryAuthorization}
        onlyCopy={false}
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

  it("reports a different Google account as such, naming the one to choose", async () => {
    const onRetryAuthorization = vi.fn();
    render(
      <ConfirmGoogleDetachment
        canConfirm={false}
        canRetryAuthorization
        email="alex@example.com"
        error={{ code: "google_account_mismatch" }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onRetryAuthorization={onRetryAuthorization}
        onlyCopy={false}
        open
        pending={false}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You chose a different Google account. To remove this backup, choose alex@example.com in Google’s window.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(/connect/u);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetryAuthorization).toHaveBeenCalledOnce();
  });

  it("shows user copy and keeps the safe error code in collapsed technical details", async () => {
    render(
      <ConfirmGoogleDetachment
        canConfirm
        canRetryAuthorization={false}
        email="alex@example.com"
        error={{ code: "google_drive_cleanup_failed" }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onRetryAuthorization={vi.fn()}
        onlyCopy={false}
        open
        pending={false}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Passport couldn’t finish deleting the backup from Google Drive. This pubky is still attached to alex@example.com. Try again.",
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
      email: "alex@example.com",
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
      onRetryAuthorization: vi.fn(),
      onlyCopy: false,
      open: true,
    };
    const { rerender } = render(<ConfirmGoogleDetachment {...props} error={null} pending />);

    const confirm = await screen.findByRole("button", { name: "Detaching…" });
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
      "Passport couldn’t finish deleting the backup from Google Drive. This pubky is still attached to alex@example.com. Try again.",
    );
  });
});
