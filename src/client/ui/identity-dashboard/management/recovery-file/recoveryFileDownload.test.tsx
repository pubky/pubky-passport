/** @vitest-environment jsdom */

import { Result } from "better-result";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../../../../libs/logger/logger";
import { RecoveryFileDownload } from "./recoveryFileDownload";

const MOCKS = vi.hoisted(() => ({ showDownloadConfirmation: vi.fn() }));
const RECOVERY_PASSWORD = "correct horse";

vi.mock("../../../shared/sonner", () => ({
  showDownloadConfirmation: MOCKS.showDownloadConfirmation,
}));

describe("RecoveryFileDownload", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("encrypts and downloads the recovery file under Strict Mode", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const createRecoveryFile = vi.fn(async () =>
      Result.ok({ bytes, fileName: "pubky-identity.pkarr" }),
    );
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const onBack = vi.fn();
    render(
      <StrictMode>
        <RecoveryFileDownload
          createRecoveryFile={createRecoveryFile}
          publicKeyZ32="identity"
          onBack={onBack}
        />
      </StrictMode>,
    );

    const download = screen.getByRole("button", { name: "Download backup" });
    const password = screen.getByLabelText("Recovery password");
    expect(screen.getByRole("heading", { name: "Encrypted backup." })).toBeInTheDocument();
    expect(password).toHaveAttribute("minlength", "12");
    expect(download).toBeDisabled();
    await userEvent.setup().type(password, RECOVERY_PASSWORD);
    await userEvent.setup().click(download);

    expect(createRecoveryFile).toHaveBeenCalledWith("identity", RECOVERY_PASSWORD);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:backup");
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(MOCKS.showDownloadConfirmation).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("revokes the recovery-file URL when clicking the download link throws", async () => {
    const createRecoveryFile = vi.fn(async () =>
      Result.ok({
        bytes: new Uint8Array([1, 2, 3]),
        fileName: "pubky-identity.pkarr",
      }),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("download failed");
    });
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const onBack = vi.fn();
    render(
      <RecoveryFileDownload
        createRecoveryFile={createRecoveryFile}
        publicKeyZ32="identity"
        onBack={onBack}
      />,
    );

    await userEvent.setup().type(screen.getByLabelText("Recovery password"), RECOVERY_PASSWORD);
    await userEvent.setup().click(screen.getByRole("button", { name: "Download backup" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not create the recovery file",
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:backup");
    expect(warning).toHaveBeenCalledWith(
      "identity.recovery_file.ui.failed",
      expect.objectContaining({
        operation: "download",
        diagnosticId: expect.any(String),
        errorName: "Error",
      }),
    );
    expect(MOCKS.showDownloadConfirmation).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("returns to identity management", async () => {
    const onBack = vi.fn();
    render(
      <RecoveryFileDownload createRecoveryFile={vi.fn()} publicKeyZ32="identity" onBack={onBack} />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("announces recovery-file failures without marking a valid password invalid", async () => {
    const warning = vi.spyOn(LOGGER, "warn").mockImplementation(() => undefined);
    const secret = "sensitive recovery cause";
    const onBack = vi.fn();
    render(
      <RecoveryFileDownload
        createRecoveryFile={async () =>
          Result.err({
            code: "recovery_file_failed",
            cause: new Error(secret),
          })
        }
        publicKeyZ32="identity"
        onBack={onBack}
      />,
    );
    const password = screen.getByLabelText("Recovery password");
    await userEvent.setup().type(password, RECOVERY_PASSWORD);
    await userEvent.setup().click(screen.getByRole("button", { name: "Download backup" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not create the recovery file",
    );
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
    render(
      <RecoveryFileDownload
        createRecoveryFile={createRecoveryFile}
        publicKeyZ32="identity"
        onBack={vi.fn()}
      />,
    );

    const password = screen.getByLabelText("Recovery password");
    await userEvent.setup().type(password, RECOVERY_PASSWORD);
    await userEvent.setup().click(screen.getByRole("button", { name: "Download backup" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not create the recovery file",
    );
    expect(password).toHaveValue("");
    expect(warning).toHaveBeenCalledWith(
      "identity.recovery_file.ui.failed",
      expect.objectContaining({
        operation: "create_and_download",
        diagnosticId: expect.any(String),
        errorName: "TypeError",
      }),
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain(secret);
  });

  it("disables Back and ignores completion after the screen is left", async () => {
    let finish!: (
      result: ReturnType<typeof Result.ok<{ bytes: Uint8Array; fileName: string }>>,
    ) => void;
    const createRecoveryFile = vi.fn(
      () =>
        new Promise<ReturnType<typeof Result.ok<{ bytes: Uint8Array; fileName: string }>>>(
          (resolve) => {
            finish = resolve;
          },
        ),
    );
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    const onBack = vi.fn();
    const rendered = render(
      <RecoveryFileDownload
        createRecoveryFile={createRecoveryFile}
        publicKeyZ32="identity"
        onBack={onBack}
      />,
    );
    await userEvent.setup().type(screen.getByLabelText("Recovery password"), RECOVERY_PASSWORD);
    await userEvent.setup().click(screen.getByRole("button", { name: "Download backup" }));

    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    rendered.unmount();
    await act(async () =>
      finish(Result.ok({ bytes: new Uint8Array([1]), fileName: "backup.pkarr" })),
    );

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(MOCKS.showDownloadConfirmation).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });
});
