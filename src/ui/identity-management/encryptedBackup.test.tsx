/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EncryptedBackup } from "./encryptedBackup";

describe("EncryptedBackup", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("encrypts and downloads the recovery file with the entered password", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const createBackup = vi.fn(async () => Result.ok({ bytes, fileName: "pubky-identity.pkarr" }));
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<EncryptedBackup createBackup={createBackup} identityId="identity" onBack={vi.fn()} />);

    const download = screen.getByRole("button", { name: "Download backup" });
    expect(download).toBeDisabled();
    await userEvent.setup().type(screen.getByLabelText("Enter strong password"), "a strong password");
    await userEvent.setup().click(download);

    expect(createBackup).toHaveBeenCalledWith("identity", "a strong password");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:backup");
    expect(bytes).toEqual(new Uint8Array(3));
  });

  it("returns to identity management", async () => {
    const onBack = vi.fn();
    const { container } = render(<EncryptedBackup createBackup={vi.fn()} identityId="identity" onBack={onBack} />);
    expect(container.querySelector('[data-slot="encrypted-backup-illustration"]')).toHaveAttribute("src", expect.stringContaining("passport-encrypted-backup.png"));
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
