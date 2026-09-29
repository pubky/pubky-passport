/** @vitest-environment jsdom */

import { Result } from "better-result";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecoveryFileDownload } from "./recoveryFileDownload";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const RECOVERY_PASSWORD = "correct horse battery";
const SKIP = "Skip this check (not recommended)";

// BackupFlow's own tests cover the download, verification and failure handling; these only
// check how management wires it to the identity.
describe("RecoveryFileDownload", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("backs up the managed identity, checks the file through the catalog and returns", async () => {
    const createRecoveryFile = vi.fn(async () =>
      Result.ok({ bytes: new Uint8Array([1, 2, 3]), fileName: "pubky-identity.pkarr" }),
    );
    const verifyRecoveryFile = vi.fn(async () => Result.ok());
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(
      <RecoveryFileDownload
        createRecoveryFile={createRecoveryFile}
        verifyRecoveryFile={verifyRecoveryFile}
        publicKeyZ32="identity"
        onBack={onBack}
      />,
    );

    await enterNewPassword(user);
    await user.click(screen.getByRole("button", { name: "Download backup" }));
    expect(createRecoveryFile).toHaveBeenCalledExactlyOnceWith("identity", RECOVERY_PASSWORD);
    expect(onBack).not.toHaveBeenCalled();

    await user.upload(screen.getByLabelText("Backup file"), backupFile());
    await user.type(screen.getByLabelText("Backup password"), RECOVERY_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Verify backup" }));
    expect(verifyRecoveryFile).toHaveBeenCalledExactlyOnceWith(
      "identity",
      expect.any(Uint8Array),
      RECOVERY_PASSWORD,
    );
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("offers to skip the check unless a removal waits on it", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const createRecoveryFile = async () =>
      Result.ok({ bytes: new Uint8Array([1, 2, 3]), fileName: "pubky-identity.pkarr" });
    const onBack = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <RecoveryFileDownload
        createRecoveryFile={createRecoveryFile}
        verifyRecoveryFile={vi.fn()}
        publicKeyZ32="identity"
        onBack={onBack}
      />,
    );
    await enterNewPassword(user);
    await user.click(screen.getByRole("button", { name: "Download backup" }));
    await user.click(screen.getByRole("button", { name: SKIP }));
    expect(onBack).toHaveBeenCalledOnce();
    view.unmount();

    render(
      <RecoveryFileDownload
        allowSkip={false}
        createRecoveryFile={createRecoveryFile}
        verifyRecoveryFile={vi.fn()}
        publicKeyZ32="identity"
        onBack={vi.fn()}
      />,
    );
    await enterNewPassword(user);
    await user.click(screen.getByRole("button", { name: "Download backup" }));
    expect(screen.getByRole("heading", { name: "Verify backup." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SKIP })).not.toBeInTheDocument();
  });

  it("returns to identity management with Back", async () => {
    const onBack = vi.fn();
    render(
      <RecoveryFileDownload
        createRecoveryFile={vi.fn()}
        verifyRecoveryFile={vi.fn()}
        publicKeyZ32="identity"
        onBack={onBack}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

async function enterNewPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Enter strong password"), RECOVERY_PASSWORD);
  await user.type(screen.getByLabelText("Confirm password"), RECOVERY_PASSWORD);
}

function backupFile() {
  return new File([new Uint8Array([1, 2, 3])], "pubky-identity.pkarr", {
    type: "application/octet-stream",
  });
}
