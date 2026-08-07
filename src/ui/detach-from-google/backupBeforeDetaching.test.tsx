/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackupBeforeDetaching } from "./backupBeforeDetaching";

describe("BackupBeforeDetaching", () => {
  afterEach(cleanup);

  it("shows the Figma backup gate and its available backup methods", () => {
    render(<BackupBeforeDetaching onBack={vi.fn()} onBackupConfirmed={vi.fn()} onDownloadBackup={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Backup your pubky first." })).toBeInTheDocument();
    expect(screen.getByText("Choose backup method")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Migrate to keychain" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download encrypted backup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I backed up my pubky" })).toBeInTheDocument();
  });

  it("supports returning and opening the existing encrypted backup screen", async () => {
    const onBack = vi.fn();
    const onBackupConfirmed = vi.fn();
    const onDownloadBackup = vi.fn();
    render(<BackupBeforeDetaching onBack={onBack} onBackupConfirmed={onBackupConfirmed} onDownloadBackup={onDownloadBackup} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Download encrypted backup" }));
    expect(onDownloadBackup).toHaveBeenCalledOnce();
    await userEvent.setup().click(screen.getByRole("button", { name: "I backed up my pubky" }));
    expect(onBackupConfirmed).toHaveBeenCalledOnce();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
