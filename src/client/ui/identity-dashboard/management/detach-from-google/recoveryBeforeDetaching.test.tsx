/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { KeyBackupFile } from "@/client/logic/local-identity/keyBackup";
import { formatBackupDate } from "@/client/ui/identity-dashboard/backupStatus";
import { RecoveryBeforeDetaching } from "./recoveryBeforeDetaching";

function renderGate(backupChecked: boolean, recordedBackup?: KeyBackupFile) {
  const actions = {
    onBack: vi.fn(),
    onRecoveryConfirmed: vi.fn(),
    onDownloadRecoveryFile: vi.fn(),
    onMigrateToKeychain: vi.fn(),
  };
  render(
    <RecoveryBeforeDetaching
      backupChecked={backupChecked}
      recordedBackup={recordedBackup}
      {...actions}
    />,
  );
  return actions;
}

const ACKNOWLEDGEMENT =
  "I have this pubky in Pubky Ring or in a recovery file. Without one, I can’t recover it if this browser’s data is cleared.";
const CHECKED_AT = new Date("2026-09-28T10:00:00Z");

describe("RecoveryBeforeDetaching", () => {
  afterEach(cleanup);

  it("shows the recovery gate and its available recovery methods", () => {
    renderGate(false);

    expect(screen.getByRole("heading", { name: "Back up your pubky first." })).toBeInTheDocument();
    expect(screen.getByText(/Detaching deletes your Google Drive backup/u)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Choose backup method" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use in Pubky Ring" })).toHaveClass("min-h-15");
    expect(screen.getByRole("button", { name: "Download recovery file" })).toHaveClass("min-h-15");
    expect(screen.getByRole("button", { name: "Back" }).closest(".grid")).toHaveClass(
      "mt-auto",
      "md:mt-0",
    );
  });

  it("keeps the way on closed until the person confirms a backup of their own", async () => {
    const actions = renderGate(false);
    const user = userEvent.setup();
    const proceed = screen.getByRole("button", { name: "Continue to detach" });

    expect(screen.queryByRole("button", { name: "I backed up my pubky" })).not.toBeInTheDocument();
    expect(proceed).toBeDisabled();
    await user.click(proceed);
    expect(actions.onRecoveryConfirmed).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox", { name: ACKNOWLEDGEMENT }));
    expect(proceed).toBeEnabled();
    await user.click(proceed);
    expect(actions.onRecoveryConfirmed).toHaveBeenCalledOnce();
  });

  it("lets a recovery file checked here count without the acknowledgement", async () => {
    const actions = renderGate(true, { verified: true, at: CHECKED_AT });

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your recovery file opened with its password.",
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue to detach" }));
    expect(actions.onRecoveryConfirmed).toHaveBeenCalledOnce();
  });

  // A file checked or imported earlier may be gone by now, so it is named but still acknowledged.
  it("names a recovery file checked earlier, dated as on logging out, and keeps the acknowledgement", async () => {
    const actions = renderGate(false, { verified: true, at: CHECKED_AT });

    expect(screen.getByRole("status")).toHaveTextContent(
      `You checked a recovery file of this key on ${formatBackupDate(CHECKED_AT)}. Make sure you still have the file and its password.`,
    );
    const proceed = screen.getByRole("button", { name: "Continue to detach" });
    expect(proceed).toBeDisabled();
    await userEvent.setup().click(screen.getByRole("checkbox", { name: ACKNOWLEDGEMENT }));
    await userEvent.setup().click(proceed);
    expect(actions.onRecoveryConfirmed).toHaveBeenCalledOnce();
  });

  it("does not present a recovery file that was only made as checked", () => {
    renderGate(false, { verified: false, at: CHECKED_AT });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: ACKNOWLEDGEMENT })).not.toBeChecked();
  });

  it("opens the backup methods and returns", async () => {
    const actions = renderGate(false);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Use in Pubky Ring" }));
    expect(actions.onMigrateToKeychain).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Download recovery file" }));
    expect(actions.onDownloadRecoveryFile).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(actions.onBack).toHaveBeenCalledOnce();
  });
});
