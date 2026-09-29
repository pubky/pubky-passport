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
import { RecoveryScreen } from "@/client/ui/shared/recoveryScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { Input } from "@/client/ui/shared/primitives/input";
import { Label } from "@/client/ui/shared/primitives/label";

type BackupResult<T> = ResultType<T, { code: string }>;
/** Where a failure is announced: next to the field it concerns, or for the whole form. */
type FlowError = { target: "password" | "file" | "form"; message: string };
type Confirmation = "empty" | "typing" | "mismatch" | "match";

/** Browsers may start the download asynchronously; revoking at once can cancel it. */
const BLOB_URL_REVOKE_DELAY_MS = 1_000;

/**
 * Shared download and file check for signup and identity management. `checkOnly` opens a backup
 * made earlier at the check and leaves from there; `allowSkip` offers to skip the check of a
 * file this session downloaded.
 */
export function BackupFlow({
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
  const [confirmation, setConfirmation] = useState<Confirmation>("empty");
  const [hasFile, setHasFile] = useState(false);
  const [error, setError] = useState<FlowError>();
  // The file this session downloaded; skipping its check is only offered for such a file.
  const [downloadedFile, setDownloadedFile] = useState<string>();
  const downloadedHere = downloadedFile !== undefined;
  const password = useRef<HTMLInputElement>(null);
  const passwordConfirmation = useRef<HTMLInputElement>(null);
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
  const passwordTooShort = !confirming && passwordLength > 0 && !validPassword;
  // Every new backup's password is typed twice: the file check below may be skipped, and a typo
  // would leave the file unreadable, possibly as the key's only copy outside this browser.
  const needsConfirmation = !confirming;
  const canSubmit = validPassword && (!needsConfirmation || confirmation === "match");

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
    if (passwordConfirmation.current) passwordConfirmation.current.value = "";
    setPasswordLength(0);
    setConfirmation("empty");
  }

  function updatePasswordState() {
    const value = password.current?.value ?? "";
    const repeated = passwordConfirmation.current?.value ?? "";
    setPasswordLength(value.length);
    setConfirmation(confirmationState(value, repeated));
    setError(undefined);
  }

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !canSubmit) return;
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
        toast.success("Backup download started");
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
      toast.success("Backup download started");
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
      setError(verificationError("invalid_backup", checkOnly));
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
        setError(verificationError(verified.error.code, checkOnly));
      } else {
        toast.success("Backup verified");
        onComplete();
      }
    } catch {
      if (active.current)
        setError({ target: "form", message: "Passport could not verify the selected backup." });
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
    setConfirmation("empty");
    setHasFile(false);
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
      title={
        confirming ? "Verify backup." : creatingAccount ? "Protect your key." : "Encrypted backup."
      }
      description={
        confirming
          ? `Pick ${downloadedHere ? "the file you just downloaded" : "your backup file"} and enter its password. This proves ${restores}.`
          : creatingAccount
            ? "Your key is saved only in this browser. If you clear your browsing data or lose this device, this backup file and its password are the only way back into your account. Nobody can reset the password, not even Passport."
            : "Encrypt a backup of your key with a strong password and keep the file somewhere safe. You’ll need both to restore your pubky, and nobody can reset the password."
      }
    >
      <form
        key={step}
        className="flex flex-col gap-6"
        aria-busy={pending}
        onSubmit={confirming ? verify : download}
      >
        {confirming ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="backup-file">Backup file</Label>
            <Input
              id="backup-file"
              type="file"
              accept=".pkarr,application/octet-stream"
              ref={file}
              disabled={pending}
              containerClassName="border-dashed"
              aria-invalid={fileError ? true : undefined}
              aria-describedby={
                [downloadedFile && "backup-file-help", fileError && "backup-file-error"]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              onChange={(event) => {
                setHasFile(Boolean(event.currentTarget.files?.length));
                setError(undefined);
              }}
            />
            {/* One hint with the retry inline, not a row of its own, keeps the primary in a popup. */}
            {downloadedFile ? (
              <FieldMessage id="backup-file-help">
                Download started:{" "}
                <span className="whitespace-nowrap font-medium text-foreground">
                  {shortFileName(downloadedFile)}
                </span>
                . Not in your downloads?{" "}
                <button
                  className="cursor-pointer rounded-sm font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand disabled:cursor-default disabled:opacity-50"
                  disabled={pending}
                  onClick={downloadAgain}
                  type="button"
                >
                  Download again
                </button>
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
            {confirming ? "Backup password" : "Enter strong password"}
          </Label>
          <Input
            id="backup-password"
            type="password"
            ref={password}
            required
            readOnly={pending}
            minLength={confirming ? undefined : MINIMUM_BACKUP_PASSWORD_LENGTH}
            maxLength={MAXIMUM_BACKUP_PASSWORD_LENGTH}
            autoComplete={confirming ? "current-password" : "new-password"}
            containerClassName="border-dashed"
            aria-invalid={passwordTooShort || Boolean(passwordError) || undefined}
            aria-describedby={
              [confirming ? null : "backup-password-help", passwordError && "backup-password-error"]
                .filter(Boolean)
                .join(" ") || undefined
            }
            onInput={updatePasswordState}
          />
          {confirming ? null : (
            <FieldMessage id="backup-password-help" error={passwordTooShort}>
              {`Minimum ${MINIMUM_BACKUP_PASSWORD_LENGTH} characters.`}
            </FieldMessage>
          )}
          {passwordError ? (
            <FieldMessage id="backup-password-error" error role="alert">
              {passwordError}
            </FieldMessage>
          ) : null}
        </div>
        {needsConfirmation ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="backup-password-confirmation">Confirm password</Label>
            <Input
              id="backup-password-confirmation"
              type="password"
              ref={passwordConfirmation}
              required
              readOnly={pending}
              maxLength={MAXIMUM_BACKUP_PASSWORD_LENGTH}
              autoComplete="new-password"
              containerClassName="border-dashed"
              aria-invalid={confirmation === "mismatch" || undefined}
              aria-describedby={
                confirmation === "mismatch" ? "backup-password-confirmation-error" : undefined
              }
              onInput={updatePasswordState}
            />
            {confirmation === "mismatch" ? (
              <FieldMessage id="backup-password-confirmation-error" error role="alert">
                Passwords do not match.
              </FieldMessage>
            ) : null}
          </div>
        ) : null}
        {formError ? (
          <Notice focusOnMount tone="error">
            {formError}
          </Notice>
        ) : null}
        <PassportNavigation
          layout="paired"
          back={<BackButton disabled={pending} onClick={back} />}
          confirm={
            <Button
              className="w-full"
              disabled={!canSubmit || (confirming && !hasFile)}
              loading={pending}
              size="lg"
              type="submit"
            >
              {confirming ? <CheckIcon /> : <DownloadIcon />}
              {pending
                ? confirming
                  ? "Verifying…"
                  : "Encrypting…"
                : confirming
                  ? creatingAccount
                    ? "Verify and create account"
                    : "Verify backup"
                  : creatingAccount
                    ? "Download encrypted backup"
                    : "Download backup"}
            </Button>
          }
        />
        {/* The check is the only proof the file and password open, so skipping comes last. */}
        {confirming && downloadedHere && allowSkip ? (
          <Button
            variant="ghost"
            className="self-center text-muted-foreground"
            disabled={pending}
            onClick={onSkip}
          >
            Skip this check (not recommended)
          </Button>
        ) : null}
      </form>
    </RecoveryScreen>
  );
}

function confirmationState(value: string, repeated: string): Confirmation {
  if (!repeated) return "empty";
  if (repeated === value) return "match";
  return value.startsWith(repeated) ? "typing" : "mismatch";
}

/** `checkOnly` checks a file made earlier, so the messages do not assume a fresh download. */
function verificationError(code: string, checkOnly: boolean): FlowError {
  switch (code) {
    case "backup_mismatch":
      return {
        target: "file",
        message: checkOnly
          ? "That file is a backup of a different pubky. Select the backup of this one."
          : "That backup belongs to a different Pubky. Select the backup just created.",
      };
    case "invalid_backup":
      return {
        target: "file",
        message: checkOnly
          ? "Select your backup file (it ends in .pkarr)."
          : "Select the backup file you just downloaded (it ends in .pkarr).",
      };
    case "invalid_password":
    case "backup_decryption_failed":
      return {
        target: "password",
        message: "The password is wrong or the selected backup is malformed.",
      };
    default:
      return { target: "form", message: "Passport could not verify the selected backup." };
  }
}

/** `pubky-<key>.pkarr` with the key cut to its ends, e.g. `pubky-1xgt9g…zwsqdy.pkarr`. */
function shortFileName(fileName: string): string {
  const extension = fileName.endsWith(".pkarr") ? ".pkarr" : "";
  const base = fileName.slice(0, fileName.length - extension.length);
  return base.length > 24 ? `${base.slice(0, 12)}…${base.slice(-6)}${extension}` : fileName;
}

function createFailure(): FlowError {
  return { target: "form", message: "Could not create the recovery file. Please try again." };
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
