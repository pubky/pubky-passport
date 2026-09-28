/** @vitest-environment jsdom */

import { Result } from "better-result";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecoveryFileDownload } from "./recoveryFileDownload";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const RECOVERY_PASSWORD = "correct horse";

// BackupFlow's own tests cover the download, verification and failure handling; these only
// check how management wires it to the identity.
describe("RecoveryFileDownload", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("backs up the managed identity and returns once the file check is skipped", async () => {
    const createRecoveryFile = vi.fn(async () =>
      Result.ok({ bytes: new Uint8Array([1, 2, 3]), fileName: "pubky-identity.pkarr" }),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(
      <RecoveryFileDownload
        createRecoveryFile={createRecoveryFile}
        publicKeyZ32="identity"
        onBack={onBack}
      />,
    );

    await user.type(screen.getByLabelText("Enter strong password"), RECOVERY_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Download backup" }));
    expect(createRecoveryFile).toHaveBeenCalledExactlyOnceWith("identity", RECOVERY_PASSWORD);
    expect(onBack).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Skip verification" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("returns to identity management with Back", async () => {
    const onBack = vi.fn();
    render(
      <RecoveryFileDownload createRecoveryFile={vi.fn()} publicKeyZ32="identity" onBack={onBack} />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
