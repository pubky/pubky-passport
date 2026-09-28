"use client";

import { Result, type Result as ResultType } from "better-result";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  MAXIMUM_BACKUP_BYTES,
  MAXIMUM_BACKUP_PASSWORD_LENGTH,
  MINIMUM_BACKUP_PASSWORD_LENGTH,
  verifyBackupFile,
} from "@/client/logic/backup/BackupVerifier";
import type { LocalIdentityRecoveryFile } from "@/client/logic/local-identity/LocalIdentityController";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { BackButton } from "@/client/ui/shared/backButton";
import { DownloadIcon, CheckIcon } from "@/client/ui/shared/icons";
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

/** Shared download and optional file check for signup and identity management. */
export function BackupFlow({
  publicKey,
  createBackup,
  verifyBackup = (bytes, password) => verifyBackupFile(bytes, password, publicKey),
  initialStep = "password",
  onReturnToPassword,
  onBack,
  onComplete,
  onSkip = onComplete,
  creatingAccount = false,
}: {
  publicKey: string;
  createBackup: (
    password: string,
  ) => BackupResult<LocalIdentityRecoveryFile> | Promise<BackupResult<LocalIdentityRecoveryFile>>;
  verifyBackup?: (
    bytes: Uint8Array,
    password: string,
  ) => BackupResult<unknown> | Promise<BackupResult<unknown>>;
  initialStep?: "password" | "confirm";
  onReturnToPassword?: () => BackupResult<void>;
  onBack: () => void;
  onComplete: () => void;
  onSkip?: () => void;
  creatingAccount?: boolean;
}) {
  const [step, setStep] = useState(initialStep);
  const [pending, setPending] = useState(false);
  const [passwordLength, setPasswordLength] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation>("empty");
  const [hasFile, setHasFile] = useState(false);
  const [error, setError] = useState<FlowError>();
  // Skipping the file check is only offered when this session created the download.
  const [downloadedHere, setDownloadedHere] = useState(false);
  const [downloadable, setDownloadable] = useState(false);
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
  // A new account's password is typed twice: its first backup may skip the file check below,
  // and a typo would leave the key's only copy outside the browser unreadable.
  const needsConfirmation = creatingAccount && !confirming;
  const canSubmit = validPassword && (!needsConfirmation || confirmation === "match");

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      lastDownload.current = null;
    };
  }, []);

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
        toast.success("File downloaded");
        setDownloadable(true);
        setDownloadedHere(true);
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
      toast.success("File downloaded");
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
      setError({ target: "file", message: "Select the .pkarr backup you just downloaded." });
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
        setError(verificationError(verified.error.code));
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
    if (step === "password") return onBack();
    const returned = onReturnToPassword?.();
    if (returned && Result.isError(returned)) {
      setError({ target: "form", message: "Passport could not save your progress. Try again." });
      return;
    }
    setError(undefined);
    setPasswordLength(0);
    setConfirmation("empty");
    setHasFile(false);
    setDownloadedHere(false);
    setDownloadable(false);
    lastDownload.current = null;
    setStep("password");
  }

  const passwordError = error?.target === "password" ? error.message : undefined;
  const fileError = error?.target === "file" ? error.message : undefined;
  const formError = error?.target === "form" ? error.message : undefined;
  const canDownloadAgain = confirming && downloadable;
  return (
    <RecoveryScreen
      title={
        confirming ? "Verify backup." : creatingAccount ? "Protect your key." : "Encrypted backup."
      }
      description={
        confirming
          ? downloadedHere
            ? "Check that your downloaded backup opens with your password. You can skip this check."
            : "Check that your downloaded backup opens with your password."
          : "Encrypt your backup with a strong password and keep the file somewhere safe. You’ll need both to restore your identity."
      }
    >
      {creatingAccount && !confirming ? (
        <p className="break-all text-xs text-muted-foreground">Pubky: {publicKey}</p>
      ) : null}
      <form
        key={step}
        className="flex flex-col gap-6"
        aria-busy={pending}
        onSubmit={confirming ? verify : download}
      >
        {confirming ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="backup-file">Backup just downloaded</Label>
            <Input
              id="backup-file"
              type="file"
              accept=".pkarr,application/octet-stream"
              ref={file}
              disabled={pending}
              containerClassName="border-dashed"
              aria-invalid={fileError ? true : undefined}
              aria-describedby={fileError ? "backup-file-error" : undefined}
              onChange={(event) => {
                setHasFile(Boolean(event.currentTarget.files?.length));
                setError(undefined);
              }}
            />
            {fileError ? (
              <FieldMessage id="backup-file-error" error role="alert">
                {fileError}
              </FieldMessage>
            ) : null}
            {canDownloadAgain ? (
              <Button
                className="self-start"
                disabled={pending}
                onClick={downloadAgain}
                size="sm"
                variant="ghost"
              >
                <DownloadIcon />
                Download again
              </Button>
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
            disabled={pending}
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
              disabled={pending}
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
          <FieldMessage error role="alert">
            {formError}
          </FieldMessage>
        ) : null}
        {confirming && downloadedHere ? (
          <Button variant="ghost" className="self-center" disabled={pending} onClick={onSkip}>
            Skip verification
          </Button>
        ) : null}
        <PassportNavigation
          layout="paired"
          back={<BackButton disabled={pending} onClick={back} />}
          confirm={
            <Button
              className="w-full"
              disabled={pending || !canSubmit || (confirming && !hasFile)}
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
      </form>
    </RecoveryScreen>
  );
}

function confirmationState(value: string, repeated: string): Confirmation {
  if (!repeated) return "empty";
  if (repeated === value) return "match";
  return value.startsWith(repeated) ? "typing" : "mismatch";
}

function verificationError(code: string): FlowError {
  switch (code) {
    case "backup_mismatch":
      return {
        target: "file",
        message: "That backup belongs to a different Pubky. Select the backup just created.",
      };
    case "invalid_backup":
      return { target: "file", message: "Select the .pkarr backup you just downloaded." };
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
