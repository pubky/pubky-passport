/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { KeyBackupFile } from "@/client/logic/local-identity/keyBackup";
import { formatBackupDate } from "@/client/ui/identity-dashboard/backupStatus";
import { RecoveryBeforeDetaching } from "./recoveryBeforeDetaching";

function renderGate(backupChecked: boolean, recordedBackup?: KeyBackupFile, ringVerifiedAt?: Date) {
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
      ringVerifiedAt={ringVerifiedAt}
      {...actions}
    />,
  );
  return actions;
}

const ONLY_COPY_WARNING =
  "No backup of this key has been verified. You can still detach, but you’ll type ONLY COPY to confirm that this browser keeps the only copy of your key.";
const CHECKED_AT = new Date("2026-09-28T10:00:00Z");

describe("RecoveryBeforeDetaching", () => {
  afterEach(cleanup);

  it("shows the recovery gate and its available recovery methods", () => {
    renderGate(false);

    expect(screen.getByRole("heading", { name: "Back up your pubky first." })).toBeInTheDocument();
    expect(screen.getByText(/Detaching deletes your Google Drive backup/u)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Choose backup method" })).toBeInTheDocument();
    // Pubky Ring is listed first as the recommended backup: the filled brand button, the same as
    // Continue to detach; the recovery file stays a plain secondary button.
    const ring = screen.getByRole("button", { name: "Migrate to Pubky Ring" });
    const file = screen.getByRole("button", { name: "Download recovery file" });
    expect(ring).toHaveClass("min-h-15", "bg-brand/16", "border-brand");
    expect(ring).not.toHaveClass("bg-secondary", "border-brand/64");
    expect(ring.className).toBe(
      screen.getByRole("button", { name: "Continue to detach" }).className,
    );
    expect(file).toHaveClass("min-h-15", "bg-secondary", "border-transparent");
    expect(ring.compareDocumentPosition(file)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole("button", { name: "Back" }).closest(".grid")).toHaveClass(
      "mt-auto",
      "md:mt-0",
    );
  });

  // The acknowledgement is typed in the confirmation, so the way on is open and says so.
  it("warns without a checked recovery file that detaching asks for a typed acknowledgement", async () => {
    const actions = renderGate(false);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(ONLY_COPY_WARNING);
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "warning");
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue to detach" }));
    expect(actions.onRecoveryConfirmed).toHaveBeenCalledOnce();
  });

  it("goes on directly after a recovery file checked here", async () => {
    const actions = renderGate(true, { verified: true, at: CHECKED_AT });

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your recovery file opened with its password.",
    );
    expect(screen.queryByText(/ONLY COPY/u)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue to detach" }));
    expect(actions.onRecoveryConfirmed).toHaveBeenCalledOnce();
  });

  // A checked or imported recovery file counts, whenever it happened.
  it("goes on directly after a recovery file checked earlier, dated as on logging out", async () => {
    const actions = renderGate(false, { verified: true, at: CHECKED_AT });

    expect(screen.getByRole("status")).toHaveTextContent(
      `You checked a recovery file of this key on ${formatBackupDate(CHECKED_AT)}. Make sure you still have the file and its password.`,
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/ONLY COPY/u)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue to detach" }));
    expect(actions.onRecoveryConfirmed).toHaveBeenCalledOnce();
  });

  it("goes on directly after Pubky Ring signed in with the key, dated", () => {
    renderGate(false, { verified: false, at: CHECKED_AT }, CHECKED_AT);

    expect(screen.getByRole("status")).toHaveTextContent(
      `Pubky Ring signed in with this key on ${formatBackupDate(CHECKED_AT)}. Make sure Pubky Ring still has it.`,
    );
    expect(screen.queryByText(ONLY_COPY_WARNING)).not.toBeInTheDocument();
  });

  it("does not count a recovery file that was only made", () => {
    renderGate(false, { verified: false, at: CHECKED_AT });

    expect(screen.getByRole("status")).toHaveTextContent(ONLY_COPY_WARNING);
  });

  it("opens the backup methods and returns", async () => {
    const actions = renderGate(false);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Migrate to Pubky Ring" }));
    expect(actions.onMigrateToKeychain).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Download recovery file" }));
    expect(actions.onDownloadRecoveryFile).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(actions.onBack).toHaveBeenCalledOnce();
  });
});
