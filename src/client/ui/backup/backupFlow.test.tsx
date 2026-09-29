/** @vitest-environment jsdom */

import { Result } from "better-result";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MINIMUM_BACKUP_PASSWORD_LENGTH } from "@/client/logic/backup/BackupVerifier";
import { BackupFlow } from "./backupFlow";

const MOCKS = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: MOCKS.toastSuccess } }));

const PASSWORD = "correct horse battery";
const FILE_NAME = "pubky-1xgt9gp7ab4hd8mzpo3c6jyofk3rqx7u8ueo1bghwzq5h9zwsqdy.pkarr";
const SKIP = "Skip this check (not recommended)";

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
        createBackup={createBackup}
        verifyBackup={vi.fn()}
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
    // Passport starts the download; it cannot know the file was saved.
    expect(MOCKS.toastSuccess.mock.calls).toEqual([
      ["Recovery file download started"],
      ["Recovery file download started"],
    ]);
  });

  it("requires a matching confirmation, and says so when the download is pressed without it", async () => {
    const createBackup = vi.fn(() =>
      Result.ok({ bytes: new Uint8Array([1, 2, 3]), fileName: "pubky-identity.pkarr" }),
    );
    mockDownload();
    render(
      <BackupFlow
        creatingAccount
        createBackup={createBackup}
        verifyBackup={vi.fn()}
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
    // The primary stays reachable; pressing it early says what is missing, where it is missing.
    expect(download).toBeEnabled();

    await user.type(password, PASSWORD);
    await user.click(download);
    expect(createBackup).not.toHaveBeenCalled();
    expect(confirmation).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("Type the password again to confirm it.");
    // A partial second entry is not flagged while typed, even after that early press, only once
    // the field is left; a diverging one is flagged at once.
    await user.type(confirmation, PASSWORD.slice(0, 4));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(confirmation).not.toHaveAttribute("aria-invalid");
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");
    await user.click(confirmation);
    await user.type(confirmation, PASSWORD.slice(4, 6));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.type(confirmation, "X");
    const mismatch = screen.getByRole("alert");
    expect(mismatch).toHaveTextContent("Passwords do not match.");
    expect(confirmation).toHaveAttribute("aria-invalid", "true");
    expect(confirmation).toHaveAttribute("aria-describedby", mismatch.id);

    await user.clear(confirmation);
    await user.type(confirmation, PASSWORD);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(download);
    expect(createBackup).toHaveBeenCalledWith(PASSWORD);
    expect(screen.getByRole("heading", { name: "Verify recovery file." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SKIP })).toBeEnabled();
    expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Recovery file password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  it("says the key lives only here and nobody can reset the password when creating an account", () => {
    render(
      <BackupFlow
        creatingAccount
        createBackup={vi.fn()}
        verifyBackup={vi.fn()}
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Protect your key." })).toBeInTheDocument();
    expect(screen.getByText(/Your key is saved only in this browser/u)).toHaveTextContent(
      "Nobody can reset the password, not even Passport.",
    );
    expect(screen.queryByText(/^Pubky:/u)).not.toBeInTheDocument();
  });

  it("flags a short password once the field is left or the download pressed, not while typing", async () => {
    const createBackup = vi.fn(() =>
      Result.ok({ bytes: new Uint8Array([1, 2, 3]), fileName: "pubky-identity.pkarr" }),
    );
    mockDownload();
    render(
      <BackupFlow
        createBackup={createBackup}
        verifyBackup={vi.fn()}
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const password = screen.getByLabelText("Enter strong password");
    const download = screen.getByRole("button", { name: "Download backup" });
    expect(screen.getByText(/nobody can reset the password/u)).toBeInTheDocument();
    await user.click(download);
    expect(password).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(
      `Enter a password of at least ${MINIMUM_BACKUP_PASSWORD_LENGTH} characters.`,
    );
    await user.type(password, "x");
    const short = "x".repeat(MINIMUM_BACKUP_PASSWORD_LENGTH - 2);
    await user.type(password, short);
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      `Too short: use at least ${MINIMUM_BACKUP_PASSWORD_LENGTH} characters.`,
    );
    await user.type(password, "x");
    expect(password).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Management backups are typed twice too: a typo would make the file useless.
    await user.click(download);
    expect(createBackup).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Confirm password"), "x".repeat(12));
    await user.click(download);
    expect(createBackup).toHaveBeenCalledWith("x".repeat(12));
  });

  it("keeps the length hint quiet while typing and marks it once the field is left", async () => {
    render(
      <BackupFlow
        createBackup={vi.fn()}
        verifyBackup={vi.fn()}
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const password = screen.getByLabelText("Enter strong password");
    await user.type(password, "a");
    const hint = screen.getByText(`Minimum ${MINIMUM_BACKUP_PASSWORD_LENGTH} characters.`);
    expect(hint).not.toHaveAttribute("role");
    expect(password).not.toHaveAttribute("aria-invalid");
    await user.tab();
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Too short");
  });

  it("shows and hides both new passwords with one toggle", async () => {
    render(
      <BackupFlow
        createBackup={vi.fn()}
        verifyBackup={vi.fn()}
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const password = screen.getByLabelText("Enter strong password");
    const confirmation = screen.getByLabelText("Confirm password");
    const reveal = screen.getByRole("button", { name: "Show password" });
    expect(reveal).toHaveAttribute("aria-pressed", "false");
    expect(reveal).toHaveAttribute("aria-controls", `${password.id} ${confirmation.id}`);
    expect(password).toHaveAttribute("type", "password");
    await user.click(reveal);
    expect(reveal).toHaveAttribute("aria-pressed", "true");
    expect(password).toHaveAttribute("type", "text");
    expect(confirmation).toHaveAttribute("type", "text");
    await user.click(reveal);
    expect(password).toHaveAttribute("type", "password");
    expect(confirmation).toHaveAttribute("type", "password");
  });

  it("checks a half-typed password with the toggle without leaving the field", async () => {
    render(
      <BackupFlow
        createBackup={vi.fn()}
        verifyBackup={vi.fn()}
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const password = screen.getByLabelText("Enter strong password");
    await user.type(password, "half");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    // Pressing the toggle is not leaving the field, so the short password is not called wrong.
    expect(password).toHaveFocus();
    expect(password).toHaveAttribute("type", "text");
    expect(password).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.keyboard(" typed on");
    expect(password).toHaveValue("half typed on");
  });

  it("asks for the file saved on an earlier visit, and offers a new backup when it is lost", async () => {
    const onReturnToPassword = vi.fn(() => Result.ok());
    render(
      <BackupFlow
        backupFileName={FILE_NAME}
        creatingAccount
        initialStep="confirm"
        createBackup={vi.fn()}
        verifyBackup={vi.fn()}
        onReturnToPassword={onReturnToPassword}
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Verify recovery file." })).toBeInTheDocument();
    expect(screen.getByText(/Pick the recovery file you saved earlier/u)).toBeInTheDocument();
    // Skipping needs a download from this session; after a reload only the file check remains.
    expect(screen.queryByRole("button", { name: SKIP })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download again" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Download started/u)).not.toBeInTheDocument();
    const file = screen.getByLabelText("Recovery file you saved earlier");
    const help = screen.getByText(/Can’t find it\?/u);
    expect(help).toHaveTextContent("Look for pubky-1xgt9g…zwsqdy.pkarr.");
    expect(help).toHaveTextContent("Your earlier file keeps working.");
    expect(file.getAttribute("aria-describedby")).toContain(help.id);

    await userEvent.setup().click(screen.getByRole("button", { name: "Make a new recovery file" }));
    expect(onReturnToPassword).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Protect your key." })).toBeInTheDocument();
  });

  it("puts the skip after the primary, names the downloaded file and hides the skip when required", async () => {
    mockDownload();
    const onSkip = vi.fn();
    const createBackup = () => Result.ok({ bytes: new Uint8Array([1, 2, 3]), fileName: FILE_NAME });
    const view = render(
      <BackupFlow
        createBackup={createBackup}
        verifyBackup={vi.fn()}
        onBack={vi.fn()}
        onComplete={vi.fn()}
        onSkip={onSkip}
      />,
    );
    const user = userEvent.setup();
    await enterNewPassword(user);
    await user.click(screen.getByRole("button", { name: "Download backup" }));

    const file = screen.getByLabelText("Recovery file");
    const help = screen.getByText(/Download started/u);
    // One line names the file and offers the retry inline, so the primary stays in view.
    expect(help).toHaveTextContent(
      "Download started: pubky-1xgt9g…zwsqdy.pkarr. Not in your downloads? Download again",
    );
    expect(help.querySelector("span")).toHaveClass("whitespace-nowrap");
    const again = screen.getByRole("button", { name: "Download again" });
    expect(help).toContainElement(again);
    // The same text action as Skip this check below it, not a second, brand-coloured style.
    expect(again).toHaveClass("underline", "text-secondary-foreground", "inline", "text-xs");
    expect(again).not.toHaveClass("text-brand");
    expect(file).toHaveAttribute("aria-describedby", help.id);
    const verify = screen.getByRole("button", { name: "Verify recovery file" });
    const skip = screen.getByRole("button", { name: SKIP });
    expect(verify.compareDocumentPosition(skip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(skip);
    expect(onSkip).toHaveBeenCalledOnce();

    view.unmount();
    render(
      <BackupFlow
        allowSkip={false}
        createBackup={createBackup}
        verifyBackup={vi.fn()}
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    await enterNewPassword(user);
    await user.click(screen.getByRole("button", { name: "Download backup" }));
    expect(screen.getByRole("heading", { name: "Verify recovery file." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SKIP })).not.toBeInTheDocument();
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
        createBackup={createBackup}
        verifyBackup={vi.fn()}
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await enterNewPassword(user);
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
    const heading = screen.getByRole("heading", { name: "Verify recovery file." });
    expect(heading).toHaveFocus();

    const verify = screen.getByRole("button", { name: "Verify and create account" });
    const file = screen.getByLabelText("Recovery file");
    // Pressed early, the check names what is missing and moves to it.
    await user.click(verify);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Select the recovery file you just downloaded (it ends in .pkarr).",
    );
    expect(file).toHaveFocus();
    await user.upload(file, backupFile());
    await user.click(verify);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter the password of this recovery file.",
    );
    expect(screen.getByLabelText("Recovery file password")).toHaveFocus();
    expect(verifyBackup).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Recovery file password"), PASSWORD);
    await user.click(verify);
    const fileError = await screen.findByRole("alert");
    expect(fileError).toHaveTextContent("different pubky");
    expect(file).toHaveAttribute("aria-invalid", "true");
    expect(file.getAttribute("aria-describedby")?.split(" ")).toContain(fileError.id);
    expect(file).toHaveFocus();

    await user.type(screen.getByLabelText("Recovery file password"), PASSWORD);
    await user.click(verify);
    const passwordError = await screen.findByRole("alert");
    expect(passwordError).toHaveTextContent("password is wrong");
    const password = screen.getByLabelText("Recovery file password");
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
        createBackup={() =>
          new Promise((resolve) => {
            fail = () => resolve(Result.err({ code: "create_failed" }));
          })
        }
        verifyBackup={vi.fn()}
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
        createBackup={vi.fn()}
        verifyBackup={vi.fn()}
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Recovery file password"), PASSWORD);
    const file = screen.getByLabelText("Recovery file you saved earlier");
    await user.upload(file, new File([], "empty.pkarr"));
    await user.click(screen.getByRole("button", { name: "Verify recovery file" }));
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent(
      "Select the recovery file you saved earlier (it ends in .pkarr).",
    );
    expect(file.getAttribute("aria-describedby")?.split(" ")).toContain(error.id);
  });

  it("opens the downloaded file with any non-empty password", async () => {
    const verifyBackup = vi.fn(() => Result.ok());
    const onComplete = vi.fn();
    render(
      <BackupFlow
        initialStep="confirm"
        createBackup={vi.fn()}
        verifyBackup={verifyBackup}
        onBack={vi.fn()}
        onComplete={onComplete}
      />,
    );
    const user = userEvent.setup();
    const password = screen.getByLabelText("Recovery file password");
    expect(password).not.toHaveAttribute("minlength");
    expect(screen.queryByText(/Minimum \d+ characters/u)).not.toBeInTheDocument();
    await user.upload(screen.getByLabelText("Recovery file you saved earlier"), backupFile());
    await user.type(password, "pin");
    await user.click(screen.getByRole("button", { name: "Verify recovery file" }));
    expect(verifyBackup).toHaveBeenCalledWith(expect.any(Uint8Array), "pin");
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("checks a backup made earlier and leaves from the check", async () => {
    const verifyBackup = vi
      .fn()
      .mockReturnValueOnce(Result.err({ code: "backup_mismatch" }))
      .mockReturnValueOnce(Result.ok());
    const onBack = vi.fn();
    const onComplete = vi.fn();
    render(
      <BackupFlow
        checkOnly
        createBackup={vi.fn()}
        verifyBackup={verifyBackup}
        onBack={onBack}
        onComplete={onComplete}
      />,
    );
    const user = userEvent.setup();
    expect(screen.getByRole("heading", { name: "Verify recovery file." })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pick your recovery file and enter its password. This proves it can restore your pubky.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SKIP })).not.toBeInTheDocument();

    await user.upload(screen.getByLabelText("Recovery file"), backupFile());
    await user.type(screen.getByLabelText("Recovery file password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Verify recovery file" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That recovery file belongs to a different pubky.",
    );
    await user.type(screen.getByLabelText("Recovery file password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Verify recovery file" }));
    expect(onComplete).toHaveBeenCalledOnce();

    // Back leaves the check instead of offering to create a new file.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Enter strong password")).not.toBeInTheDocument();
  });
});
