import { Result } from "better-result";
import Image from "next/image";
import { type SubmitEvent, useEffect, useRef, useState } from "react";

import { LOGGER, safeErrorLogFields } from "../../../../../libs/logger/logger";
import {
  MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS,
  type LocalIdentityRecoveryFile,
  type LocalIdentityRecoveryFileResult,
} from "../../../../logic/local-identity/LocalIdentityController";
import { DownloadRecoveryFileIcon } from "../../../shared/actionIcons";
import { BackButton } from "../../../shared/backButton";
import { showFileDownloaded } from "../../../shared/feedbackNotifications";
import { PassportNavigation } from "../../../shared/passportNavigation";
import { PassportScreen } from "../../../shared/passportScreen";
import { Button } from "../../../shared/primitives/button";
import { FieldMessage } from "../../../shared/primitives/fieldMessage";
import { Input } from "../../../shared/primitives/input";
import { Label } from "../../../shared/primitives/label";
import { DisplayHeading, LeadText } from "../../../shared/primitives/typography";

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
  const [validPassword, setValidPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [recoveryFileFailed, setRecoveryFileFailed] = useState(false);
  const activeRef = useRef(true);

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
    let password = passwordInput.value;
    passwordInput.value = "";
    setValidPassword(false);
    setPending(true);
    setRecoveryFileFailed(false);
    let downloaded = false;
    try {
      let recoveryFilePromise: ReturnType<typeof createRecoveryFile>;
      try {
        recoveryFilePromise = createRecoveryFile(publicKeyZ32, password);
      } finally {
        password = "";
      }
      const recoveryFile = await recoveryFilePromise;
      if (!activeRef.current) return;
      if (Result.isError(recoveryFile) || !downloadFile(recoveryFile.value))
        setRecoveryFileFailed(true);
      else {
        downloaded = true;
      }
    } catch (cause) {
      LOGGER.warn("identity.recovery_file.ui.failed", {
        operation: "create_and_download",
        ...safeErrorLogFields(cause),
      });
      if (activeRef.current) setRecoveryFileFailed(true);
    } finally {
      if (activeRef.current) setPending(false);
    }
    if (downloaded && activeRef.current) {
      showFileDownloaded();
      onBack();
    }
  }

  return (
    <PassportScreen>
      <form
        className="flex min-h-full flex-1 flex-col gap-6 md:grid md:grid-cols-[307px_281px] md:grid-rows-[136px_224px_60px] md:gap-x-0 md:gap-y-8 md:pt-[34px]"
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
              autoComplete="new-password"
              containerClassName="h-14 border-dashed md:h-[60px]"
              id="recovery-file-password"
              maxLength={1024}
              minLength={MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS}
              onInput={(event) =>
                setValidPassword(
                  event.currentTarget.value.length >= MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS,
                )
              }
              ref={passwordInputRef}
              required
              type="password"
            />
            {recoveryFileFailed ? (
              <FieldMessage error>
                Could not create the recovery file. Please try again.
              </FieldMessage>
            ) : null}
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
  } catch (cause) {
    LOGGER.warn("identity.recovery_file.ui.failed", {
      operation: "download",
      ...safeErrorLogFields(cause),
    });
    return false;
  }
}

export { RecoveryFileDownload };
