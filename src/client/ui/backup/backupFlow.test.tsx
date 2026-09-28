/** @vitest-environment jsdom */

import { Result } from "better-result";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MINIMUM_BACKUP_PASSWORD_LENGTH } from "@/client/logic/backup/BackupVerifier";
import { BackupFlow } from "./backupFlow";

const MOCKS = vi.hoisted(() => ({ toastSuccess: vi.fn(), verifyBackupFile: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: MOCKS.toastSuccess } }));
vi.mock("@/client/logic/backup/BackupVerifier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/client/logic/backup/BackupVerifier")>()),
  verifyBackupFile: MOCKS.verifyBackupFile,
}));

const PASSWORD = "correct horse battery";

function backupFile() {
  return new File([new Uint8Array([1, 2, 3])], "pubky-identity.pkarr", {
    type: "application/octet-stream",
  });
}

function mockDownload() {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
  const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  return { revokeObjectURL, click };
}

async function enterNewPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Enter strong password"), PASSWORD);
  await user.type(screen.getByLabelText("Confirm password"), PASSWORD);
}

describe("BackupFlow", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // Runs first: later download tests leave real one-second revocation timers behind.
  it("revokes the download URL after the browser had time to start, and can download again", async () => {
    // Hold the deferred revocation so the test controls when the second elapses.
    const realSetTimeout = globalThis.setTimeout;
    const deferred: Array<() => void> = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: () => void,
      delay?: number,
      ...rest: unknown[]
    ) => {
      if (delay === 1_000) {
        deferred.push(callback);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(callback, delay, ...rest);
    }) as typeof setTimeout);
    const createBackup = vi.fn(() =>
      Result.ok({ bytes: new Uint8Array([1, 2, 3]), fileName: "pubky-identity.pkarr" }),
    );
    const { revokeObjectURL, click } = mockDownload();
    render(
      <BackupFlow
        creatingAccount
        publicKey="identity"
        createBackup={createBackup}
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await enterNewPassword(user);
    await user.click(screen.getByRole("button", { name: "Download encrypted backup" }));
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    // The revocation is scheduled a second out so the browser can start the download first.
    expect(deferred).toHaveLength(1);
    act(() => deferred[0]!());
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:backup");

    await user.click(screen.getByRole("button", { name: "Download again" }));
    expect(click).toHaveBeenCalledTimes(2);
    expect(createBackup).toHaveBeenCalledOnce();
    expect(MOCKS.toastSuccess).toHaveBeenCalledTimes(2);
  });

  it("requires a matching confirmation before the account backup can be downloaded", async () => {
    const createBackup = vi.fn(() =>
      Result.ok({ bytes: new Uint8Array([1, 2, 3]), fileName: "pubky-identity.pkarr" }),
    );
    mockDownload();
    render(
      <BackupFlow
        creatingAccount
        publicKey="identity"
        createBackup={createBackup}
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const password = screen.getByLabelText("Enter strong password");
    const confirmation = screen.getByLabelText("Confirm password");
    const download = screen.getByRole("button", { name: "Download encrypted backup" });
    expect(screen.getByText(`Minimum ${MINIMUM_BACKUP_PASSWORD_LENGTH} characters.`)).toBeVisible();
    expect(password).toHaveAttribute("minlength", String(MINIMUM_BACKUP_PASSWORD_LENGTH));
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(confirmation).toHaveAttribute("autocomplete", "new-password");
    expect(download).toBeDisabled();

    await user.type(password, PASSWORD);
    expect(download).toBeDisabled();
    // A partial second entry is not flagged yet; a diverging one is.
    await user.type(confirmation, PASSWORD.slice(0, 4));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.type(confirmation, "X");
    const mismatch = screen.getByRole("alert");
    expect(mismatch).toHaveTextContent("Passwords do not match.");
    expect(confirmation).toHaveAttribute("aria-invalid", "true");
    expect(confirmation).toHaveAttribute("aria-describedby", mismatch.id);
    expect(download).toBeDisabled();

    await user.clear(confirmation);
    await user.type(confirmation, PASSWORD);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(download).toBeEnabled();
    await user.click(download);
    expect(createBackup).toHaveBeenCalledWith(PASSWORD);
    expect(screen.getByRole("heading", { name: "Verify backup." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip verification" })).toBeEnabled();
    expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Backup password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  it("rejects passwords shorter than the minimum", async () => {
    render(
      <BackupFlow
        publicKey="identity"
        createBackup={vi.fn()}
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const password = screen.getByLabelText("Enter strong password");
    // Management backups keep a single entry; the key stays saved in this browser.
    expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();
    const short = "x".repeat(MINIMUM_BACKUP_PASSWORD_LENGTH - 1);
    await user.type(password, short);
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Download backup" })).toBeDisabled();
    await user.type(password, "x");
    expect(screen.getByRole("button", { name: "Download backup" })).toBeEnabled();
  });

  it("does not offer to skip verification when resuming without a download from this session", () => {
    render(
      <BackupFlow
        creatingAccount
        initialStep="confirm"
        publicKey="identity"
        createBackup={vi.fn()}
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Verify backup." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip verification" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download again" })).not.toBeInTheDocument();
  });

  it("revokes the URL immediately when the download click throws", async () => {
    const createBackup = vi.fn(() =>
      Result.ok({ bytes: new Uint8Array([1, 2, 3]), fileName: "pubky-identity.pkarr" }),
    );
    const { revokeObjectURL, click } = mockDownload();
    click.mockImplementation(() => {
      throw new Error("download failed");
    });
    render(
      <BackupFlow
        publicKey="identity"
        createBackup={createBackup}
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Enter strong password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Download backup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not create the recovery file",
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:backup");
  });

  it("ties verification errors to the field they concern and moves focus to each", async () => {
    const verifyBackup = vi
      .fn()
      .mockReturnValueOnce(Result.err({ code: "backup_mismatch" }))
      .mockReturnValueOnce(Result.err({ code: "backup_decryption_failed" }))
      .mockReturnValueOnce(Result.ok());
    const onComplete = vi.fn();
    mockDownload();
    render(
      <BackupFlow
        creatingAccount
        publicKey="identity"
        createBackup={() =>
          Result.ok({ bytes: new Uint8Array([1, 2, 3]), fileName: "pubky-identity.pkarr" })
        }
        verifyBackup={verifyBackup}
        onBack={vi.fn()}
        onComplete={onComplete}
      />,
    );
    const user = userEvent.setup();
    await enterNewPassword(user);
    await user.click(screen.getByRole("button", { name: "Download encrypted backup" }));
    const heading = screen.getByRole("heading", { name: "Verify backup." });
    expect(heading).toHaveFocus();

    const verify = screen.getByRole("button", { name: "Verify and create account" });
    const file = screen.getByLabelText("Backup just downloaded");
    expect(verify).toBeDisabled();
    await user.upload(file, backupFile());
    await user.type(screen.getByLabelText("Backup password"), PASSWORD);
    await user.click(verify);
    const fileError = await screen.findByRole("alert");
    expect(fileError).toHaveTextContent("different Pubky");
    expect(file).toHaveAttribute("aria-invalid", "true");
    expect(file).toHaveAttribute("aria-describedby", fileError.id);
    expect(file).toHaveFocus();

    await user.type(screen.getByLabelText("Backup password"), PASSWORD);
    await user.click(verify);
    const passwordError = await screen.findByRole("alert");
    expect(passwordError).toHaveTextContent("password is wrong");
    const password = screen.getByLabelText("Backup password");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password.getAttribute("aria-describedby")?.split(" ")).toContain(passwordError.id);
    expect(password).toHaveFocus();
    expect(file).not.toHaveAttribute("aria-invalid");

    await user.type(password, PASSWORD);
    await user.click(verify);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(verifyBackup).toHaveBeenCalledTimes(3);
  });

  it("shows a failed download as a notice that takes focus while the button is busy", async () => {
    let fail!: () => void;
    render(
      <BackupFlow
        creatingAccount
        publicKey="identity"
        createBackup={() =>
          new Promise((resolve) => {
            fail = () => resolve(Result.err({ code: "create_failed" }));
          })
        }
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await enterNewPassword(user);
    await user.click(screen.getByRole("button", { name: "Download encrypted backup" }));

    const busy = screen.getByRole("button", { name: "Encrypting…" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveFocus();
    await act(async () => fail());

    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("Could not create the recovery file");
    expect(notice).toHaveFocus();
  });

  it("flags an empty file selection on the file input", async () => {
    render(
      <BackupFlow
        initialStep="confirm"
        publicKey="identity"
        createBackup={vi.fn()}
        verifyBackup={vi.fn()}
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Backup password"), PASSWORD);
    await user.upload(screen.getByLabelText("Backup just downloaded"), new File([], "empty.pkarr"));
    await user.click(screen.getByRole("button", { name: "Verify backup" }));
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("Select the .pkarr backup");
    expect(screen.getByLabelText("Backup just downloaded")).toHaveAttribute(
      "aria-describedby",
      error.id,
    );
  });

  it("opens the downloaded file with any non-empty password", async () => {
    const verifyBackup = vi.fn(() => Result.ok());
    const onComplete = vi.fn();
    render(
      <BackupFlow
        initialStep="confirm"
        publicKey="identity"
        createBackup={vi.fn()}
        verifyBackup={verifyBackup}
        onBack={vi.fn()}
        onComplete={onComplete}
      />,
    );
    const user = userEvent.setup();
    const password = screen.getByLabelText("Backup password");
    expect(password).not.toHaveAttribute("minlength");
    expect(screen.queryByText(/Minimum \d+ characters/u)).not.toBeInTheDocument();
    await user.upload(screen.getByLabelText("Backup just downloaded"), backupFile());
    await user.type(password, "pin");
    await user.click(screen.getByRole("button", { name: "Verify backup" }));
    expect(verifyBackup).toHaveBeenCalledWith(expect.any(Uint8Array), "pin");
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("verifies through the logic layer when no controller supplies a check", async () => {
    MOCKS.verifyBackupFile
      .mockResolvedValueOnce(Result.err({ code: "verification_failed" }))
      .mockResolvedValueOnce(Result.ok());
    const onComplete = vi.fn();
    render(
      <BackupFlow
        initialStep="confirm"
        publicKey="identity"
        createBackup={vi.fn()}
        onBack={vi.fn()}
        onComplete={onComplete}
      />,
    );
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Backup just downloaded"), backupFile());
    await user.type(screen.getByLabelText("Backup password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Verify backup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Passport could not verify the selected backup.",
    );
    expect(MOCKS.verifyBackupFile).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      PASSWORD,
      "identity",
    );
    expect(onComplete).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Backup password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Verify backup" }));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(MOCKS.verifyBackupFile).toHaveBeenCalledTimes(2);
  });
});
