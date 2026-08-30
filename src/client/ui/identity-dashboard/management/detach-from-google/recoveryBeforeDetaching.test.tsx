/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecoveryBeforeDetaching } from "./recoveryBeforeDetaching";

describe("RecoveryBeforeDetaching", () => {
  afterEach(cleanup);

  it("shows the recovery gate and its available recovery methods", () => {
    render(
      <RecoveryBeforeDetaching
        onBack={vi.fn()}
        onRecoveryConfirmed={vi.fn()}
        onDownloadRecoveryFile={vi.fn()}
        onMigrateToKeychain={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Backup your pubky first." })).toBeInTheDocument();
    expect(screen.getByText("Choose backup method").parentElement).toHaveClass("pt-6", "md:pt-0");
    expect(screen.getByRole("button", { name: "Migrate to keychain" })).toHaveClass("h-[60px]");
    expect(screen.getByRole("button", { name: "Download encrypted backup" })).toHaveClass(
      "h-[60px]",
    );
    expect(screen.getByRole("button", { name: "I backed up my pubky" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" }).closest(".grid")).toHaveClass(
      "mt-auto",
      "md:mt-0",
    );
  });

  it("supports returning and opening the recovery-file screen", async () => {
    const onBack = vi.fn();
    const onRecoveryConfirmed = vi.fn();
    const onDownloadRecoveryFile = vi.fn();
    const onMigrateToKeychain = vi.fn();
    render(
      <RecoveryBeforeDetaching
        onBack={onBack}
        onRecoveryConfirmed={onRecoveryConfirmed}
        onDownloadRecoveryFile={onDownloadRecoveryFile}
        onMigrateToKeychain={onMigrateToKeychain}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Migrate to keychain" }));
    expect(onMigrateToKeychain).toHaveBeenCalledOnce();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Download encrypted backup" }));
    expect(onDownloadRecoveryFile).toHaveBeenCalledOnce();
    await userEvent.setup().click(screen.getByRole("button", { name: "I backed up my pubky" }));
    expect(onRecoveryConfirmed).toHaveBeenCalledOnce();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
