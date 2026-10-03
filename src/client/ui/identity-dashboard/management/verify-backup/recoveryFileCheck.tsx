"use client";

import { Result } from "better-result";
import { type FormEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { backupFileName, MAXIMUM_BACKUP_BYTES } from "@/client/logic/backup/BackupVerifier";
import { keyBackupFile } from "@/client/logic/local-identity/keyBackup";
import type { LocalIdentityBackupCheckResult } from "@/client/logic/local-identity/LocalIdentityController";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import {
  type FlowError,
  shortFileName,
  verificationError,
} from "@/client/ui/backup/recoveryFileMessages";
import { BackupStatusLine, formatBackupDate } from "@/client/ui/identity-dashboard/backupStatus";
import { CheckIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { FileField } from "@/client/ui/shared/primitives/fileField";
import { Input } from "@/client/ui/shared/primitives/input";
import { Label } from "@/client/ui/shared/primitives/label";
import { RevealPasswordButton } from "@/client/ui/shared/revealPasswordButton";
import { ChoiceCard } from "@/client/ui/shared/choiceCard";

/**
 * The recovery-file half of Verify your backup: pick a file of this key and enter its password;
 * Passport opens it in the browser, without signing in or keeping its key, and records the check
 * (by `verifyRecoveryFile`). Success and failure are said here, in the card; the Pubky Ring card
 * beside it is not touched. The file's bytes and the password are cleared after every attempt.
 */
export function RecoveryFileCheck({
  identity,
  onVerified,
  verifyRecoveryFile,
}: {
  identity: LocalIdentityMetadata;
  /** Told when a file opened with its password. */
  onVerified?: (() => void) | undefined;
  verifyRecoveryFile: (
    publicKeyZ32: string,
    recoveryFile: Uint8Array,
    password: string,
  ) => Promise<LocalIdentityBackupCheckResult>;
}) {
  const publicKeyZ32 = identity.publicIdentity.publicKeyZ32;
  const checked = keyBackupFile(identity);
  const fileName = backupFileName(publicKeyZ32);
  const ids = useId();
  const [pending, setPending] = useState(false);
  const [passed, setPassed] = useState(false);
  const [error, setError] = useState<FlowError>();
  const [passwordShown, setPasswordShown] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const passedLine = useRef<HTMLParagraphElement>(null);
  const active = useRef(true);
  const busy = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  // A failed check empties the password: move focus to what failed instead of losing it.
  useLayoutEffect(() => {
    if (pending || !error) return;
    if (error.target === "password") password.current?.focus();
    else if (error.target === "file") file.current?.focus();
  }, [error, pending]);
  // The form goes away once the file opened; focus follows to what says so.
  useLayoutEffect(() => {
    if (passed) passedLine.current?.focus();
  }, [passed]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const selected = file.current?.files?.[0];
    if (!selected || !selected.size || selected.size > MAXIMUM_BACKUP_BYTES) {
      setError(verificationError("invalid_backup", "check", fileName));
      return;
    }
    if (!password.current?.value) {
      setError({ target: "password", message: "Enter the password of this recovery file." });
      return;
    }
    busy.current = true;
    setPending(true);
    setError(undefined);
    const value = password.current.value;
    password.current.value = "";
    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await selected.arrayBuffer());
      if (!active.current) return;
      const verified = await verifyRecoveryFile(publicKeyZ32, bytes, value);
      if (!active.current) return;
      if (Result.isError(verified)) {
        setError(verificationError(verified.error.code, "check", fileName));
        return;
      }
      setPassed(true);
      onVerified?.();
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

  const fileError = error?.target === "file" ? error.message : undefined;
  const passwordError = error?.target === "password" ? error.message : undefined;
  const formError = error?.target === "form" ? error.message : undefined;
  return (
    <ChoiceCard
      dense
      description={
        checked?.verified ? `Last checked ${formatBackupDate(checked.at)}` : "Never checked"
      }
      illustration="/illustrations/file.png"
      title="Recovery file"
    >
      {passed ? (
        <BackupStatusLine ref={passedLine} tabIndex={-1} tone="ok">
          Recovery file verified: it opens with its password and holds this pubky’s key. Keep the
          file and its password somewhere safe.
        </BackupStatusLine>
      ) : (
        <form aria-busy={pending} className="flex flex-col gap-4" noValidate onSubmit={verify}>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${ids}-file`}>Recovery file</Label>
            <FileField
              id={`${ids}-file`}
              accept=".pkarr,application/octet-stream"
              ref={file}
              disabled={pending}
              aria-invalid={fileError ? true : undefined}
              aria-describedby={[`${ids}-file-help`, fileError && `${ids}-file-error`]
                .filter(Boolean)
                .join(" ")}
              onChange={() => setError(undefined)}
            />
            <FieldMessage id={`${ids}-file-help`}>
              Look for{" "}
              <span className="whitespace-nowrap font-medium text-foreground">
                {shortFileName(fileName)}
              </span>
              .
            </FieldMessage>
            {fileError ? (
              <FieldMessage error id={`${ids}-file-error`} role="alert">
                {fileError}
              </FieldMessage>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${ids}-password`}>Recovery file password</Label>
            <Input
              id={`${ids}-password`}
              type={passwordShown ? "text" : "password"}
              ref={password}
              required
              readOnly={pending}
              autoComplete="current-password"
              containerClassName="border-dashed"
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={passwordError ? `${ids}-password-error` : undefined}
              action={
                <RevealPasswordButton
                  controls={`${ids}-password`}
                  onToggle={() => setPasswordShown((shown) => !shown)}
                  shown={passwordShown}
                />
              }
              onInput={() => setError(undefined)}
            />
            {passwordError ? (
              <FieldMessage error id={`${ids}-password-error`} role="alert">
                {passwordError}
              </FieldMessage>
            ) : null}
          </div>
          {formError ? (
            <Notice focusOnMount tone="error">
              {formError}
            </Notice>
          ) : null}
          <Button className="w-full" loading={pending} type="submit" variant="secondary">
            <CheckIcon />
            {pending ? "Verifying…" : "Verify recovery file"}
          </Button>
        </form>
      )}
    </ChoiceCard>
  );
}
