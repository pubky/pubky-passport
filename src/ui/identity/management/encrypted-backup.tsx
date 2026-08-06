"use client";

import { Result } from "better-result";
import Image from "next/image";
import { FormEvent, useState } from "react";

import {
  MIN_BACKUP_PASSWORD_LENGTH,
  type LocalIdentityBackupFile,
  type LocalIdentityBackupResult,
} from "../../../browser/identity/passportIdentity";
import { Button } from "../../shared/primitives/button";
import { FieldMessage } from "../../shared/primitives/field-message";
import { Input } from "../../shared/primitives/input";
import { Label } from "../../shared/primitives/label";
import { DisplayHeading, LeadText } from "../../shared/primitives/typography";
import { BackButton } from "../../shared/navigation/back-button";

function EncryptedBackup({ createBackup, identityId, onBack }: {
  createBackup: (identityId: string, password: string) => Promise<LocalIdentityBackupResult>;
  identityId: string;
  onBack: () => void;
}) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const validPassword = password.length >= MIN_BACKUP_PASSWORD_LENGTH;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validPassword || pending) return;
    setPending(true);
    setError(false);
    try {
      const backup = await createBackup(identityId, password);
      if (Result.isError(backup) || !downloadFile(backup.value)) setError(true);
      else setPassword("");
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100svh-84px)] w-full max-w-[375px] flex-col px-6 pb-6 pt-3">
      <form className="flex min-h-full flex-1 flex-col gap-6" onSubmit={submit}>
        <DisplayHeading accent="backup." aria-label="Encrypted backup.">Encrypted</DisplayHeading>
        <LeadText>Set a password, download the file, and keep both somewhere safe. You’ll need them to restore access.</LeadText>

        <div className="flex flex-col gap-2">
          <Label htmlFor="backup-password">Enter strong password</Label>
          <Input
            autoComplete="new-password"
            className="border-dashed"
            id="backup-password"
            maxLength={1024}
            minLength={MIN_BACKUP_PASSWORD_LENGTH}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          {error ? <FieldMessage error>Could not create the encrypted backup. Please try again.</FieldMessage> : null}
        </div>

        <Image alt="" className="mx-auto size-[200px]" height={200} src="/illustrations/passport-encrypted-backup.png" width={200} />

        <div className="mt-auto flex flex-col gap-4 pt-4">
          <BackButton onClick={onBack} />
          <Button disabled={!validPassword || pending} size="lg" type="submit">
            <DownloadIcon />
            {pending ? "Encrypting…" : "Download backup"}
          </Button>
        </div>
      </form>
    </main>
  );
}

function DownloadIcon() {
  return <span className="flex size-4 items-center justify-center"><Image alt="" height={13.33} src="/icons/figma-download-backup.svg" width={13.33} /></span>;
}

function downloadFile(file: LocalIdentityBackupFile): boolean {
  try {
    const blob = new Blob([file.bytes.slice().buffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = file.fileName;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  } finally {
    file.bytes.fill(0);
  }
}

export { EncryptedBackup };
