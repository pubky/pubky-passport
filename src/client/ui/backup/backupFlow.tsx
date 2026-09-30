"use client";

import { Result, type Result as ResultType } from "better-result";
import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  MAXIMUM_BACKUP_BYTES,
  MAXIMUM_BACKUP_PASSWORD_LENGTH,
  MINIMUM_BACKUP_PASSWORD_LENGTH,
} from "@/client/logic/backup/BackupVerifier";
import type { LocalIdentityRecoveryFile } from "@/client/logic/local-identity/LocalIdentityController";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { BackButton } from "@/client/ui/shared/backButton";
import { DownloadIcon, CheckIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { RecoveryCard, RecoveryScreen } from "@/client/ui/shared/recoveryScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { FileField } from "@/client/ui/shared/primitives/fileField";
import { Input } from "@/client/ui/shared/primitives/input";
import { Label } from "@/client/ui/shared/primitives/label";
import { RevealPasswordButton } from "@/client/ui/shared/revealPasswordButton";

type BackupResult<T> = ResultType<T, { code: string }>;
/** Where a failure is announced: next to the field it concerns, or for the whole form. */
type FlowError = { target: "password" | "file" | "form"; message: string };
/** Which backup file the check asks for, so its messages name the right one. */
type FileSource = "downloaded" | "earlier" | "check";

/** Browsers may start the download asynchronously; revoking at once can cancel it. */
const BLOB_URL_REVOKE_DELAY_MS = 1_000;

/**
 * Shared download and file check for signup and identity management. `checkOnly` opens a backup
 * made earlier at the check and leaves from there; `allowSkip` offers to skip the check of a
 * file this session downloaded. The primary action stays enabled: pressing it with something
 * missing says what, at the field concerned.
 */
export function BackupFlow({
  backupFileName,
  createBackup,
  verifyBackup,
  initialStep = "password",
  onReturnToPassword,
  onBack,
  onComplete,
  onSkip = onComplete,
  allowSkip = true,
  checkOnly = false,
  creatingAccount = false,
}: {
  /** The name the recovery file was given, so the check and its errors can name the file. */
  backupFileName?: string | undefined;
  createBackup: (
    password: string,
  ) => BackupResult<LocalIdentityRecoveryFile> | Promise<BackupResult<LocalIdentityRecoveryFile>>;
  verifyBackup: (
    bytes: Uint8Array,
    password: string,
  ) => BackupResult<unknown> | Promise<BackupResult<unknown>>;
  initialStep?: "password" | "confirm";
  onReturnToPassword?: () => BackupResult<void>;
  onBack: () => void;
  onComplete: () => void;
  onSkip?: () => void;
  allowSkip?: boolean;
  checkOnly?: boolean;
  creatingAccount?: boolean;
}) {
  const [step, setStep] = useState(checkOnly ? "confirm" : initialStep);
  const [pending, setPending] = useState(false);
  const [passwordLength, setPasswordLength] = useState(0);
  // Set once the password field is left or the form sent, so a short password is not flagged
  // while it is still being typed.
  const [lengthChecked, setLengthChecked] = useState(false);
  const [passwordShown, setPasswordShown] = useState(false);
  const [error, setError] = useState<FlowError>();
  // The file this session downloaded; skipping its check is only offered for such a file.
  const [downloadedFile, setDownloadedFile] = useState<string>();
  const downloadedHere = downloadedFile !== undefined;
  // A check reopened on a later visit asks for a file saved then, which may be lost.
  const fileSource: FileSource = checkOnly ? "check" : downloadedHere ? "downloaded" : "earlier";
  // The file the check wants, when its name is known, so a wrong pick can be told which one.
  const expectedFileName = downloadedFile ?? backupFileName;
  const password = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const busy = useRef(false);
  // Ciphertext only: the encrypted file is kept so "Download again" needs no new password.
  const lastDownload = useRef<{ blob: Blob; fileName: string }>(null);
  const confirming = step === "confirm";
  // The creation minimum protects new files; opening one only needs the password it was made with.
  const validPassword = confirming
    ? passwordLength > 0
    : passwordLength >= MINIMUM_BACKUP_PASSWORD_LENGTH;
  // A new backup's password is typed once: the file check that follows opens the file with it,
  // which catches a typo while the key is still here (the maintainer's decision, 2026-09-30).
  const passwordTooShort = !confirming && lengthChecked && !validPassword;

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      lastDownload.current = null;
    };
  }, []);

  // A failed check empties the password, so the submit button disables itself: move focus to
  // what failed instead of letting it fall to the page.
  useLayoutEffect(() => {
    if (pending || !error) return;
    if (error.target === "password") password.current?.focus();
    else if (error.target === "file") file.current?.focus();
  }, [error, pending]);

  function clearPasswordField() {
    if (password.current) password.current.value = "";
    setPasswordLength(0);
    setLengthChecked(false);
  }

  function updatePasswordState() {
    setPasswordLength(password.current?.value.length ?? 0);
    setError(undefined);
  }

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    if (!validPassword) {
      setLengthChecked(true);
      password.current?.focus();
      return;
    }
    busy.current = true;
    setPending(true);
    setError(undefined);
    const value = password.current?.value ?? "";
    clearPasswordField();
    try {
      const backup = await createBackup(value);
      if (Result.isError(backup)) {
        if (active.current) setError(createFailure());
        return;
      }
      try {
        if (!active.current) return;
        lastDownload.current = {
          blob: new Blob([backup.value.bytes.slice().buffer], {
            type: "application/octet-stream",
          }),
          fileName: backup.value.fileName,
        };
        downloadFile(lastDownload.current);
        // Passport only starts the download; the browser may still ask where to save it.
        toast.success("Recovery file download started");
        setDownloadedFile(backup.value.fileName);
        setStep("confirm");
      } finally {
        backup.value.bytes.fill(0);
      }
    } catch (cause) {
      LOGGER.warn("identity.recovery_file.ui.failed", {
        operation: "create_and_download",
        ...safeErrorLogFields(cause),
      });
      if (active.current) setError(createFailure());
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }

  function downloadAgain() {
    if (!lastDownload.current) return;
    try {
      downloadFile(lastDownload.current);
      toast.success("Recovery file download started");
    } catch (cause) {
      LOGGER.warn("identity.recovery_file.ui.failed", {
        operation: "download_again",
        ...safeErrorLogFields(cause),
      });
      setError({ target: "form", message: "Could not start the download. Please try again." });
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const selected = file.current?.files?.[0];
    if (!selected || !selected.size || selected.size > MAXIMUM_BACKUP_BYTES) {
      setError(verificationError("invalid_backup", fileSource, expectedFileName));
      return;
    }
    if (!password.current?.value) {
      setError({ target: "password", message: "Enter the password of this recovery file." });
      return;
    }
    busy.current = true;
    setPending(true);
    setError(undefined);
    const value = password.current?.value ?? "";
    clearPasswordField();
    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await selected.arrayBuffer());
      if (!active.current) return;
      const verified = await verifyBackup(bytes, value);
      if (!active.current) return;
      if (Result.isError(verified)) {
        setError(verificationError(verified.error.code, fileSource, expectedFileName));
      } else {
        toast.success("Recovery file verified");
        onComplete();
      }
    } catch {
      if (active.current)
        setError({
          target: "form",
          message: "Passport could not verify the selected recovery file.",
        });
    } finally {
      bytes?.fill(0);
      busy.current = false;
      if (active.current) setPending(false);
    }
  }

  function back() {
    if (step === "password" || checkOnly) return onBack();
    const returned = onReturnToPassword?.();
    if (returned && Result.isError(returned)) {
      setError({ target: "form", message: "Passport could not save your progress. Try again." });
      return;
    }
    setError(undefined);
    setPasswordLength(0);
    setLengthChecked(false);
    setDownloadedFile(undefined);
    lastDownload.current = null;
    setStep("password");
  }

  const passwordError = error?.target === "password" ? error.message : undefined;
  const fileError = error?.target === "file" ? error.message : undefined;
  const formError = error?.target === "form" ? error.message : undefined;
  const restores = creatingAccount ? "you can get your account back" : "it can restore your pubky";
  return (
    <RecoveryScreen
      {...(confirming
        ? { title: "Verify", accent: "recovery file." }
        : creatingAccount
          ? { title: "Protect your", accent: "key." }
          : { title: "Make a", accent: "recovery file." })}
      description={
        confirming
          ? `Pick ${{ downloaded: "the file you just downloaded", earlier: "the recovery file you saved earlier", check: "your recovery file" }[fileSource]} and enter its password. This proves ${restores}.`
          : creatingAccount
            ? "Your key is saved only in this browser. If you clear your browsing data or lose this device, this recovery file and its password are the only way back into your account. Nobody can reset the password, not even Passport."
            : "A recovery file is a copy of your key, encrypted with a strong password. Keep the file somewhere safe. You’ll need both to restore your pubky, and nobody can reset the password."
      }
    >
      <form
        key={step}
        className="flex flex-1 flex-col gap-6 md:gap-8"
        aria-busy={pending}
        // The form says what is missing itself, beside the field, instead of the browser's bubble.
        noValidate
        onSubmit={confirming ? verify : download}
      >
        <RecoveryCard illustration="/illustrations/file.png">
          {confirming ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="backup-file">
                {fileSource === "earlier" ? "Recovery file you saved earlier" : "Recovery file"}
              </Label>
              <FileField
                id="backup-file"
                accept=".pkarr,application/octet-stream"
                ref={file}
                disabled={pending}
                aria-invalid={fileError ? true : undefined}
                aria-describedby={
                  [fileSource !== "check" && "backup-file-help", fileError && "backup-file-error"]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                onChange={() => setError(undefined)}
              />
              {/* The file first, then the retry together on a line of its own. */}
              {downloadedFile ? (
                <FieldMessage id="backup-file-help">
                  Download started:{" "}
                  <span className="whitespace-nowrap font-medium text-foreground">
                    {shortFileName(downloadedFile)}
                  </span>
                  .{" "}
                  <span className="block">
                    Not in your downloads?{" "}
                    {/* The shared text action, set in the hint's type and inline in its sentence,
                        so the line keeps its height (a link in a sentence needs no 44px target). */}
                    <Button
                      className="inline min-h-0 py-0 align-baseline text-xs leading-4 pointer-coarse:min-h-0"
                      disabled={pending}
                      onClick={downloadAgain}
                      variant="link"
                    >
                      Download again
                    </Button>
                  </span>
                </FieldMessage>
              ) : fileSource === "earlier" ? (
                // A lost file is no dead end: a new backup of the same key replaces it.
                <FieldMessage id="backup-file-help">
                  {backupFileName ? (
                    <>
                      Look for{" "}
                      <span className="whitespace-nowrap font-medium text-foreground">
                        {shortFileName(backupFileName)}
                      </span>
                      .{" "}
                    </>
                  ) : null}
                  Can’t find it?{" "}
                  <Button
                    className="inline min-h-0 py-0 align-baseline text-xs leading-4 pointer-coarse:min-h-0"
                    disabled={pending}
                    onClick={back}
                    variant="link"
                  >
                    Make a new recovery file
                  </Button>
                  . Your earlier file keeps working.
                </FieldMessage>
              ) : null}
              {fileError ? (
                <FieldMessage id="backup-file-error" error role="alert">
                  {fileError}
                </FieldMessage>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="backup-password">
              {confirming ? "Recovery file password" : "Enter strong password"}
            </Label>
            <Input
              id="backup-password"
              type={passwordShown ? "text" : "password"}
              ref={password}
              required
              readOnly={pending}
              minLength={confirming ? undefined : MINIMUM_BACKUP_PASSWORD_LENGTH}
              maxLength={MAXIMUM_BACKUP_PASSWORD_LENGTH}
              autoComplete={confirming ? "current-password" : "new-password"}
              containerClassName="border-dashed"
              aria-invalid={passwordTooShort || Boolean(passwordError) || undefined}
              action={
                <RevealPasswordButton
                  controls="backup-password"
                  onToggle={() => setPasswordShown((shown) => !shown)}
                  shown={passwordShown}
                />
              }
              onBlur={() => {
                if (passwordLength > 0) setLengthChecked(true);
              }}
              aria-describedby={
                [
                  confirming ? null : "backup-password-help",
                  passwordError && "backup-password-error",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              onInput={updatePasswordState}
            />
            {confirming ? null : (
              <FieldMessage id="backup-password-help" error={passwordTooShort}>
                {passwordTooShort
                  ? passwordLength === 0
                    ? `Enter a password of at least ${MINIMUM_BACKUP_PASSWORD_LENGTH} characters.`
                    : `Too short: use at least ${MINIMUM_BACKUP_PASSWORD_LENGTH} characters.`
                  : `Minimum ${MINIMUM_BACKUP_PASSWORD_LENGTH} characters.`}
              </FieldMessage>
            )}
            {passwordError ? (
              <FieldMessage id="backup-password-error" error role="alert">
                {passwordError}
              </FieldMessage>
            ) : null}
          </div>
        </RecoveryCard>
        {formError ? (
          <Notice focusOnMount tone="error">
            {formError}
          </Notice>
        ) : null}
        <PassportNavigation
          className="mt-auto md:mt-0"
          layout="paired"
          back={<BackButton disabled={pending} onClick={back} />}
          confirm={
            <Button className="w-full" loading={pending} size="lg" type="submit">
              {confirming ? <CheckIcon /> : <DownloadIcon />}
              {pending
                ? confirming
                  ? "Verifying…"
                  : "Encrypting…"
                : confirming
                  ? creatingAccount
                    ? "Verify and create account"
                    : "Verify recovery file"
                  : "Download recovery file"}
            </Button>
          }
          tertiary={
            // The check is the only proof the file and password open, so skipping comes last.
            confirming && downloadedHere && allowSkip ? (
              <Button disabled={pending} onClick={onSkip} variant="link">
                Skip this check (not recommended)
              </Button>
            ) : undefined
          }
        />
      </form>
    </RecoveryScreen>
  );
}

/**
 * Messages name the file asked for (just downloaded, saved on an earlier visit, or any) and, when
 * its name is known, the file itself. A password that does not open the file is most likely a
 * typo moments after it was chosen, so that comes first; a damaged file comes second.
 */
function verificationError(code: string, source: FileSource, fileName?: string): FlowError {
  const named = fileName ? shortFileName(fileName) : undefined;
  switch (code) {
    case "backup_mismatch":
      return {
        target: "file",
        message: named
          ? `This file is for a different pubky. Pick ${named}.`
          : "This file is for a different pubky. Pick the recovery file of this pubky.",
      };
    case "invalid_backup": {
      const which = {
        downloaded: "the recovery file you just downloaded",
        earlier: "the recovery file you saved earlier",
        check: "your recovery file",
      }[source];
      return {
        target: "file",
        message: named ? `Select ${which}, ${named}.` : `Select ${which} (it ends in .pkarr).`,
      };
    }
    case "invalid_password":
    case "backup_decryption_failed":
      return {
        target: "password",
        message: `That password doesn’t open this file. Passwords are case-sensitive, so check for typos and caps lock. If it’s right, the file may be damaged: ${
          {
            downloaded: "download it again.",
            earlier: "make a new recovery file.",
            check: "download a new recovery file.",
          }[source]
        }`,
      };
    default:
      return { target: "form", message: "Passport could not verify the selected recovery file." };
  }
}

/** `pubky-<key>.pkarr` with the key cut to its ends, e.g. `pubky-1xgt9g…zwsqdy.pkarr`. */
function shortFileName(fileName: string): string {
  const extension = fileName.endsWith(".pkarr") ? ".pkarr" : "";
  const base = fileName.slice(0, fileName.length - extension.length);
  return base.length > 24 ? `${base.slice(0, 12)}…${base.slice(-6)}${extension}` : fileName;
}

function createFailure(): FlowError {
  return { target: "form", message: "Couldn’t create the recovery file. Try again." };
}

function downloadFile(file: { blob: Blob; fileName: string }) {
  const url = URL.createObjectURL(file.blob);
  try {
    const link = document.createElement("a");
    link.download = file.fileName;
    link.href = url;
    link.click();
  } catch (cause) {
    URL.revokeObjectURL(url);
    throw cause;
  }
  setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_DELAY_MS);
}
