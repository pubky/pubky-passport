"use client";

import { Result } from "better-result";
import Image from "next/image";
import { type SubmitEvent, useState } from "react";

import {
  MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS,
  type LocalIdentityRecoveryFile,
  type LocalIdentityRecoveryFileResult,
} from "../../../../logic/local-identity/LocalIdentityController";
import { DownloadRecoveryFileIcon } from "../../../shared/actionIcons";
import { BackButton } from "../../../shared/backButton";
import { PassportScreen } from "../../../shared/passportScreen";
import { Button } from "../../../shared/primitives/button";
import { FieldMessage } from "../../../shared/primitives/fieldMessage";
import { Input } from "../../../shared/primitives/input";
import { Label } from "../../../shared/primitives/label";
import { DisplayHeading, LeadText } from "../../../shared/primitives/typography";
import { showDownloadConfirmation } from "../../../shared/sonner";

function RecoveryFileDownload({ createRecoveryFile, publicKeyZ32, onBack }: {
  createRecoveryFile: (publicKeyZ32: string, password: string) => Promise<LocalIdentityRecoveryFileResult>;
  publicKeyZ32: string;
  onBack: () => void;
}) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [recoveryFileFailed, setRecoveryFileFailed] = useState(false);
  const validPassword = password.length >= MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS;

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validPassword || pending) return;
    setPending(true);
    setRecoveryFileFailed(false);
    let downloaded = false;
    try {
      const recoveryFile = await createRecoveryFile(publicKeyZ32, password);
      if (Result.isError(recoveryFile) || !downloadFile(recoveryFile.value)) setRecoveryFileFailed(true);
      else {
        downloaded = true;
        setPassword("");
      }
    } catch {
      setRecoveryFileFailed(true);
    } finally {
      setPending(false);
    }
    if (downloaded) {
      showDownloadConfirmation();
      onBack();
    }
  }

  return (
    <PassportScreen>
      <form className="flex min-h-full flex-1 flex-col gap-6" onSubmit={submit}>
        <DisplayHeading accent="backup." aria-label="Encrypted backup.">Encrypted</DisplayHeading>
        <LeadText>Set a password, download the file, and keep both somewhere safe. You’ll need them to restore access.</LeadText>

        <div className="flex flex-col gap-2">
          <Label htmlFor="recovery-file-password">Enter strong password</Label>
          <Input
            autoComplete="new-password"
            containerClassName="border-dashed"
            id="recovery-file-password"
            maxLength={1024}
            minLength={MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          {recoveryFileFailed ? <FieldMessage error>Could not create the recovery file. Please try again.</FieldMessage> : null}
        </div>

        <Image alt="" aria-hidden="true" className="mx-auto size-[200px]" data-slot="recovery-file-illustration" height={200} src="/illustrations/file.png" unoptimized width={200} />

        <div className="mt-auto flex flex-col gap-4 pt-4">
          <BackButton onClick={onBack} />
          <Button disabled={!validPassword || pending} size="lg" type="submit">
            <DownloadRecoveryFileIcon />
            {pending ? "Encrypting…" : "Download backup"}
          </Button>
        </div>
      </form>
    </PassportScreen>
  );
}

function downloadFile(file: LocalIdentityRecoveryFile): boolean {
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

export { RecoveryFileDownload };
