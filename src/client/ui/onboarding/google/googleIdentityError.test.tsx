/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
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
    expect(
      screen.getByText(googleIdentityErrorMessage({ code: "foreign_passport_file" })),
    ).toBeVisible();
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

  it("offers deleting a damaged backup as a quiet option that says what is lost", async () => {
    const actions = renderError({ code: "invalid_passport_file" });

    // Signing in again would find the same file, so there is no Try again to outweigh.
    expect(screen.queryByRole("button", { name: /try/i })).not.toBeInTheDocument();
    const remove = screen.getByRole("button", { name: "Delete backup and start over…" });
    expect(remove).toHaveClass("underline");
    expect(remove).not.toHaveClass("bg-destructive-surface");
    expect(
      screen.getByText(/the pubky in it can no longer be restored with this Google account/u),
    ).toBeVisible();
    expect(screen.getByText(/go back and add it from there instead/u)).toBeVisible();

    await userEvent.setup().click(remove);
    const dialog = screen.getByRole("dialog", { name: "Delete this backup and start over?" });
    expect(dialog).toHaveAccessibleDescription(/can’t be undone/u);
    expect(within(dialog).getByRole("button", { name: "Delete and start over" })).toBeDisabled();
    await userEvent.setup().type(within(dialog).getByLabelText("Type DELETE to confirm"), "DELETE");
    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: "Delete and start over" }));
    expect(actions.onReplaceInvalidFile).toHaveBeenCalledOnce();
    expect(actions.onTryAgain).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_passport_file_delete_failed", "onReplaceInvalidFile"],
    ["undecryptable_passport_file_delete_failed", "onReplaceUndecryptableFile"],
  ] as const)(
    "after %s, deleting again is the way on, not a new sign-in",
    async (code, handler) => {
      const actions = renderError({ code });

      expect(screen.getByText(/so no new pubky was created/u)).toBeVisible();
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Delete backup/u })).not.toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole("button", { name: "Try deleting again" }));
      const dialog = screen.getByRole("dialog", { name: "Delete this backup and start over?" });
      await userEvent
        .setup()
        .type(within(dialog).getByLabelText("Type DELETE to confirm"), "DELETE");
      await userEvent
        .setup()
        .click(within(dialog).getByRole("button", { name: "Delete and start over" }));
      expect(actions[handler]).toHaveBeenCalledOnce();
      expect(actions.onTryAgain).not.toHaveBeenCalled();
    },
  );

  it("treats a closed Google window as a cancel, with no error code", async () => {
    const actions = renderError({ code: "google_authorization_popup_closed" });

    expect(screen.getByRole("heading", { name: "Google sign-in cancelled." })).toHaveFocus();
    expect(
      screen.getByText(
        "You closed Google’s window before finishing. Nothing was created or changed.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Technical details")).not.toBeInTheDocument();
    expect(screen.queryByText(/google_authorization_popup_closed/u)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(actions.onTryAgain).toHaveBeenCalledOnce();
  });

  it("offers no retry where new Google sign-ups are refused, and names the other ways in", () => {
    renderError({ code: "homeserver_signup_token_failed", detailCode: "blocked", flow: "create" });

    expect(
      screen.getByText(
        "New Google sign-ups aren’t available in your country, so nothing was created.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "There’s no Passport backup to restore in this Google account. Go back to create an account or sign in with Pubky Ring.",
      ),
    ).toBeVisible();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Back"]);
  });

  // Restore with Google while sign-ups are blocked can end here for a pubky Drive already holds.
  it("keeps a restored pubky safe when its homeserver signup is refused", () => {
    renderError({ code: "homeserver_signup_token_failed", detailCode: "blocked", flow: "repair" });

    expect(screen.getByRole("heading", { name: "Setup interrupted." })).toHaveAccessibleDescription(
      "Your pubky is safe in your Google Drive, but Passport can’t finish setting it up with its server: new Google sign-ups aren’t available in your country. Nothing was lost.",
    );
    expect(screen.queryByText(/nothing was created/iu)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/create a pubky another way|create an account/iu),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Back"]);
  });

  it("tells a new account its pubky is safe when the homeserver signup fails", () => {
    renderError({ code: "signup_failed" });

    expect(screen.getByText(/Your pubky is saved, encrypted, in your Google Drive/u)).toBeVisible();
    expect(screen.queryByText(/found your encrypted identity/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
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
        "Try again and allow Passport’s Google Drive access in Google’s window. The second permission also puts a copy of your backup in a “Pubky Passport” folder you can see.",
      ),
    ).toBeInTheDocument();
  });

  it("lets establishment continue without the optional visible copy", async () => {
    const actions = renderError({ code: "visible_backup_permission_missing" });

    expect(screen.getByRole("heading", { name: "Drive access optional." })).toBeInTheDocument();
    // The choice says what the second box adds, in the words the notices use afterwards.
    expect(
      screen.getByText(
        "You ticked the first box but not the second. Passport can still back up your pubky to Google Drive, but it won’t put a copy in a “Pubky Passport” folder you can see. That copy only makes the backup easy to find and harder to delete by accident.",
      ),
    ).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "Skip the folder copy" }));
    expect(actions.onContinueWithoutVisibleBackup).toHaveBeenCalledOnce();
  });
});
