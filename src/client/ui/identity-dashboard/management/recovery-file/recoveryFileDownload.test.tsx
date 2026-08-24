/** @vitest-environment jsdom */

import { Result } from "better-result";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../../../../libs/logger/logger";
import { RecoveryFileDownload } from "./recoveryFileDownload";

const MOCKS = vi.hoisted(() => ({ showDownloadConfirmation: vi.fn() }));

vi.mock("../../../shared/sonner", () => ({ showDownloadConfirmation: MOCKS.showDownloadConfirmation }));

describe("RecoveryFileDownload", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("encrypts and downloads the recovery file with the entered password", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const createRecoveryFile = vi.fn(async () => Result.ok({ bytes, fileName: "pubky-identity.pkarr" }));
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const onBack = vi.fn();
    render(<RecoveryFileDownload createRecoveryFile={createRecoveryFile} publicKeyZ32="identity" onBack={onBack} />);

    const download = screen.getByRole("button", { name: "Download backup" });
    const password = screen.getByLabelText("Enter strong password");
    expect(screen.getByRole("heading", { name: "Encrypted backup." })).toBeInTheDocument();
    expect(password).toHaveAttribute("minlength", "6");
    expect(download).toBeDisabled();
    await userEvent.setup().type(password, "123456");
    await userEvent.setup().click(download);

    expect(createRecoveryFile).toHaveBeenCalledWith("identity", "123456");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:backup");
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(MOCKS.showDownloadConfirmation).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("returns to identity management", async () => {
    const onBack = vi.fn();
    render(<RecoveryFileDownload createRecoveryFile={vi.fn()} publicKeyZ32="identity" onBack={onBack} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("announces recovery-file failures without marking a valid password invalid", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const secret = "sensitive recovery cause";
    const onBack = vi.fn();
    render(<RecoveryFileDownload createRecoveryFile={async () => Result.err({
      code: "recovery_file_failed",
      cause: new Error(secret),
    })} publicKeyZ32="identity" onBack={onBack} />);
    const password = screen.getByLabelText("Enter strong password");
    await userEvent.setup().type(password, "123456");
    await userEvent.setup().click(screen.getByRole("button", { name: "Download backup" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not create the recovery file");
    expect(password).not.toHaveAttribute("aria-invalid");
    expect(MOCKS.showDownloadConfirmation).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).not.toHaveTextContent(secret);
    expect(warning).not.toHaveBeenCalled();
  });

  it("contains rejected recovery-file promises without exposing their contents", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const secret = "sensitive rejected password";
    const createRecoveryFile = vi.fn(async () => {
      throw new TypeError(secret);
    });
    render(<RecoveryFileDownload
      createRecoveryFile={createRecoveryFile}
      publicKeyZ32="identity"
      onBack={vi.fn()}
    />);

    const password = screen.getByLabelText("Enter strong password");
    await userEvent.setup().type(password, "123456");
    await userEvent.setup().click(screen.getByRole("button", { name: "Download backup" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not create the recovery file");
    expect(password).toHaveValue("123456");
    expect(warning).toHaveBeenCalledWith("identity.recovery_file.ui.failed", {
      operation: "create_and_download",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(secret);
  });
});
