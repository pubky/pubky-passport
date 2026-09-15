import { Result } from "better-result";
import Image from "next/image";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import {
  MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS,
  type LocalIdentityRecoveryFile,
  type LocalIdentityRecoveryFileResult,
} from "@/client/logic/local-identity/LocalIdentityController";
import { DownloadRecoveryFileIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { Input } from "@/client/ui/shared/primitives/input";
import { Label } from "@/client/ui/shared/primitives/label";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

function RecoveryFileDownload({
  createRecoveryFile,
  publicKeyZ32,
  onBack,
}: {
  createRecoveryFile: (
    publicKeyZ32: string,
    password: string,
  ) => Promise<LocalIdentityRecoveryFileResult>;
  publicKeyZ32: string;
  onBack: () => void;
}) {
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const [passwordLength, setPasswordLength] = useState(0);
  const [pending, setPending] = useState(false);
  const [recoveryFileFailed, setRecoveryFileFailed] = useState(false);
  const activeRef = useRef(true);
  const validPassword = passwordLength >= MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS;
  const passwordTooShort = passwordLength > 0 && !validPassword;

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const passwordInput = passwordInputRef.current;
    if (!passwordInput || !validPassword || pending) return;
    const password = passwordInput.value;
    passwordInput.value = "";
    setPasswordLength(0);
    setPending(true);
    setRecoveryFileFailed(false);
    let downloaded = false;
    try {
      const recoveryFile = await createRecoveryFile(publicKeyZ32, password);
      if (!activeRef.current) return;
      if (Result.isError(recoveryFile) || !downloadFile(recoveryFile.value))
        setRecoveryFileFailed(true);
      else {
        downloaded = true;
      }
    } catch (e) {
      LOGGER.warn("identity.recovery_file.ui.failed", {
        operation: "create_and_download",
        ...safeErrorLogFields(e),
      });
      if (activeRef.current) setRecoveryFileFailed(true);
    } finally {
      if (activeRef.current) setPending(false);
    }
    if (downloaded && activeRef.current) {
      toast.success("File downloaded");
      onBack();
    }
  }

  return (
    <PassportScreen>
      <form
        className="flex min-h-full flex-1 flex-col gap-6 md:grid md:grid-cols-(--passport-content-columns) md:grid-rows-[minmax(var(--passport-recovery-heading-min-height),auto)_minmax(var(--passport-recovery-body-min-height),auto)_auto] md:content-start md:gap-x-0 md:gap-y-8 md:pt-8.5"
        onSubmit={submit}
      >
        <div className="flex flex-col gap-6 md:col-span-2 md:gap-3">
          <DisplayHeading accent="backup." aria-label="Encrypted backup.">
            Encrypted{" "}
          </DisplayHeading>
          <LeadText>
            Set a password, download the file, and keep both somewhere safe. You’ll need them to
            restore access.
          </LeadText>
        </div>

        <div className="contents md:col-start-1 md:row-start-2 md:flex md:flex-col md:gap-2">
          <div className="order-2 flex flex-col gap-2 md:contents">
            <Label className="leading-5 md:leading-4" htmlFor="recovery-file-password">
              Enter strong password
            </Label>
            <Input
              aria-describedby="recovery-file-password-requirement"
              aria-invalid={passwordTooShort || undefined}
              autoComplete="new-password"
              containerClassName="h-14 border-dashed md:h-[60px]"
              id="recovery-file-password"
              maxLength={1024}
              minLength={MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS}
              onInput={(event) => {
                setPasswordLength(event.currentTarget.value.length);
                setRecoveryFileFailed(false);
              }}
              ref={passwordInputRef}
              required
              type="password"
            />
            <FieldMessage
              error={passwordTooShort || recoveryFileFailed}
              id="recovery-file-password-requirement"
            >
              {recoveryFileFailed
                ? "Could not create the recovery file. Please try again."
                : `Minimum ${MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS} characters.`}
            </FieldMessage>
          </div>
          <Button
            className="order-5 -mt-2 w-full md:order-[0] md:mt-4"
            disabled={!validPassword || pending}
            size="lg"
            type="submit"
          >
            <DownloadRecoveryFileIcon />
            {pending ? "Encrypting…" : "Download backup"}
          </Button>
        </div>

        <Image
          alt=""
          aria-hidden="true"
          className="order-3 mx-auto size-[200px] md:order-[0] md:col-start-2 md:row-start-2 md:mt-3"
          height={200}
          src="/illustrations/file.png"
          width={200}
        />

        <PassportNavigation
          back={<BackButton disabled={pending} onClick={onBack} />}
          className="order-4 -mt-1 md:order-[0] md:col-span-2 md:row-start-3 md:mt-0"
        />
      </form>
    </PassportScreen>
  );
}

function downloadFile(file: LocalIdentityRecoveryFile): boolean {
  try {
    const blob = new Blob([file.bytes.slice().buffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.download = file.fileName;
      link.href = url;
      link.click();
      return true;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    LOGGER.warn("identity.recovery_file.ui.failed", {
      operation: "download",
      ...safeErrorLogFields(e),
    });
    return false;
  }
}

export { RecoveryFileDownload };
