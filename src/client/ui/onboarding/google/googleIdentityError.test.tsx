/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import { googleIdentityErrorMessage } from "@/client/ui/googleIdentityErrorMessage";
import { GoogleIdentityError } from "./googleIdentityError";

afterEach(cleanup);

function renderError(error: GoogleIdentityViewError) {
  const actions = {
    onBack: vi.fn(),
    onTryAgain: vi.fn(),
    onReplaceInvalidFile: vi.fn(),
    onReplaceUndecryptableFile: vi.fn(),
    onContinueWithoutVisibleBackup: vi.fn(),
  };
  render(<GoogleIdentityError error={error} {...actions} />);
  return actions;
}

describe("GoogleIdentityError", () => {
  it("shows a foreign file's origin as unverified text, with no link and no deletion", async () => {
    const actions = renderError({
      code: "foreign_passport_file",
      passportFileOrigin: "https://other.example",
    });

    expect(screen.getByRole("heading", { name: "Identity found elsewhere." })).toBeInTheDocument();
    expect(screen.getByText(googleIdentityErrorMessage("foreign_passport_file"))).toBeVisible();
    // A read-only detail, labelled as unverified, not a box that looks like a field.
    const label = screen.getByText("Site named in the file (unverified)");
    expect(label.parentElement).toHaveTextContent("https://other.example");
    expect(screen.getByText(/cannot confirm which site created this file/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/sign in on/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(actions.onBack).toHaveBeenCalledOnce();
    expect(actions.onReplaceInvalidFile).not.toHaveBeenCalled();
    expect(actions.onReplaceUndecryptableFile).not.toHaveBeenCalled();
  });

  it("never offers deletion for a foreign file whose origin was not kept", () => {
    renderError({ code: "foreign_passport_file" });

    expect(screen.getByRole("heading", { name: "Setup interrupted." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("offers deletion for a malformed file this origin can replace", () => {
    renderError({ code: "invalid_passport_file" });

    expect(screen.getAllByRole("button", { name: /delete/i }).length).toBeGreaterThan(0);
  });

  it("points a damaged file without replacement to another Google account, not a retry", () => {
    render(
      <GoogleIdentityError
        error={{ code: "invalid_passport_file" }}
        onBack={vi.fn()}
        onTryAgain={vi.fn()}
      />,
    );

    expect(screen.getByText("Go back and choose another Google account.")).toBeVisible();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Back"]);
  });

  it("states the next step and keeps Try again for a failure a retry can fix", async () => {
    const actions = renderError({ code: "drive_write_failed" });

    expect(screen.getByRole("heading", { name: "Setup interrupted." })).toHaveFocus();
    expect(screen.getByText("Check your connection, then try again.")).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(actions.onTryAgain).toHaveBeenCalledOnce();
  });

  it("shows the access-denied screen for a denied authorization", () => {
    renderError({ code: "google_authorization_denied" });

    expect(screen.getByRole("heading", { name: /access denied/i })).toBeInTheDocument();
    // Only the first permission is required; the second adds the optional visible copy.
    expect(
      screen.getByText(
        "Try again and allow Passport’s Google Drive access in Google’s window. The second permission also adds a visible recovery copy.",
      ),
    ).toBeInTheDocument();
  });

  it("lets establishment continue without the optional visible copy", async () => {
    const actions = renderError({ code: "visible_backup_permission_missing" });

    expect(screen.getByRole("heading", { name: "Drive access optional." })).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Continue without visible backup" }));
    expect(actions.onContinueWithoutVisibleBackup).toHaveBeenCalledOnce();
  });
});
