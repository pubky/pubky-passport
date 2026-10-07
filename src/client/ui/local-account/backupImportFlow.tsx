"use client";

import { Result } from "better-result";
import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

import type {
  BackupImporter,
  BackupImportErrorCode,
  BackupImportFailure,
} from "@/client/logic/backup/BackupImporter";
import {
  MAXIMUM_BACKUP_BYTES,
  MAXIMUM_BACKUP_PASSWORD_LENGTH,
} from "@/client/logic/backup/BackupVerifier";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { BackButton } from "@/client/ui/shared/backButton";
import { PUBKY_COPY_TOASTS } from "@/client/ui/shared/copyToClipboard";
import { DetailField } from "@/client/ui/shared/detailField";
import { ArrowRightIcon, RotateCcwIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { RecoveryCard, RecoveryScreen } from "@/client/ui/shared/recoveryScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { canRestoreFiles, FileField } from "@/client/ui/shared/primitives/fileField";
import { Input } from "@/client/ui/shared/primitives/input";
import { Label } from "@/client/ui/shared/primitives/label";
import { TEXT_MEASURE } from "@/client/ui/shared/primitives/typography";
import {
  REVEALABLE_PASSWORD_INPUT_PROPS,
  RevealPasswordButton,
} from "@/client/ui/shared/revealPasswordButton";

/**
 * A failed import and the next action it offers: `existing` names a saved identity to use
 * instead, `retry` sends the same file and password again.
 */
type ImportError = {
  target: "file" | "password" | "form";
  message: string;
  existing?: string;
  retry?: boolean;
};
/** Failures of a network step; the password stays in its field so Try again can resend it. */
const RETRYABLE: ReadonlySet<BackupImportErrorCode> = new Set([
  "signin_failed",
  "resolution_failed",
]);
type ImportPort = Pick<
  BackupImporter,
  "discardPending" | "dispose" | "importBackup" | "republishHomeserver"
>;

export function BackupImportFlow({
  defaultHomeserver,
  onBack,
  onComplete,
  onSelectExisting,
  createImporter = createBackupImporter,
}: {
  /**
   * The instance homeserver, offered when a lookup finds no homeserver record for the backup's
   * identity. Without one, that record cannot be repaired here.
   */
  defaultHomeserver: string | null;
  onBack: () => void;
  onComplete: (identity: LocalIdentityMetadata) => void;
  /** Continues with an identity this browser already holds, when the backup is of that one. */
  onSelectExisting?: ((publicKeyZ32: string) => void) | undefined;
  /** Builds the importer; it may load the Pubky SDK first. */
  createImporter?: () => ImportPort | Promise<ImportPort>;
}) {
  const importer = useRef<ImportPort>(null);
  const [buildImporter] = useState(() => createImporter);
  const fileInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  // The file last sent, put back into the picker when the import returns to it. Ciphertext only.
  const [keptFile, setKeptFile] = useState<File>();
  const [passwordShown, setPasswordShown] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ImportError>();
  // Set when the backup decrypted but its identity has no homeserver record to sign in with.
  const [unpublished, setUnpublished] = useState<string>();

  // A failed import empties the password; focus what failed rather than losing it to the page.
  useLayoutEffect(() => {
    if (pending || !error) return;
    if (error.target === "file") fileInput.current?.focus();
    else if (error.target === "password") passwordInput.current?.focus();
  }, [error, pending]);

  const importerReady = useRef<Promise<ImportPort | null>>(null);
  useEffect(() => {
    let active = true;
    let setup: ImportPort | undefined;
    importerReady.current = Promise.resolve()
      .then(buildImporter)
      .then(
        (built) => {
          if (!active) {
            built.dispose();
            return null;
          }
          setup = built;
          importer.current = built;
          return built;
        },
        () => null,
      );
    return () => {
      active = false;
      if (importer.current === setup) importer.current = null;
      setup?.dispose();
    };
  }, [buildImporter]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const file = fileInput.current?.files?.[0];
    const password = passwordInput.current?.value ?? "";
    if (!file || file.size === 0 || file.size > MAXIMUM_BACKUP_BYTES) {
      setError({ target: "file", message: "Choose a recovery file (.pkarr) smaller than 1 MB." });
      return;
    }
    if (!password) {
      setError(importError({ code: "invalid_password" }));
      return;
    }

    setPending(true);
    // A retry keeps its message, and the Try again inside it, in place while it runs, so focus
    // stays on the button that started it.
    setError((current) => (current?.retry ? current : undefined));
    setKeptFile(file);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // The importer may still be loading the Pubky SDK when the form is sent.
      const ready = importer.current ?? (await importerReady.current);
      const imported = await ready?.importBackup(bytes, password, defaultHomeserver);
      const failure = imported && Result.isError(imported) ? imported.error : undefined;
      if (passwordInput.current && !(failure && RETRYABLE.has(failure.code)))
        passwordInput.current.value = "";
      if (!imported || Result.isError(imported)) {
        bytes.fill(0);
        setError(importError(failure ?? { code: "import_unavailable" }));
        return;
      }
      setError(undefined);
      if (imported.value.status === "homeserver_record_missing") {
        setUnpublished(imported.value.publicIdentity.publicKeyZ32);
        return;
      }
      onComplete(imported.value.identity);
    } catch {
      setError({
        target: "form",
        message: "Passport could not read that recovery file. Try selecting it again.",
      });
    } finally {
      setPending(false);
    }
  };

  const republish = async (homeserverPubky: string) => {
    setPending(true);
    setError(undefined);
    try {
      const imported = await importer.current?.republishHomeserver(homeserverPubky);
      if (!imported || Result.isError(imported)) {
        const failure = imported ? imported.error : { code: "import_unavailable" as const };
        // The importer released the key; importing the file again signs in with that record. The
        // form puts the file back where the browser lets it, and says to pick it where not.
        if (failure.code === "homeserver_record_found") setUnpublished(undefined);
        setError(importError(failure, keptFile !== undefined && canRestoreFiles()));
        return;
      }
      onComplete(imported.value);
    } catch {
      setError(importError({ code: "publish_failed" }));
    } finally {
      setPending(false);
    }
  };

  const fileError = error?.target === "file" ? error.message : undefined;
  const passwordError = error?.target === "password" ? error.message : undefined;
  const formError = error?.target === "form" ? error : undefined;
  const existing = formError?.existing;

  if (unpublished && defaultHomeserver) {
    return (
      <RecoveryScreen
        title="Homeserver"
        accent="not found."
        description="Your recovery file opened, but the Pubky network no longer lists which homeserver holds this account. This can happen when an identity hasn’t been used for a while."
      >
        <RecoveryCard>
          <p className="text-sm leading-5">
            Passport can list this Passport’s homeserver for your account, so apps can find it
            there.
          </p>
          <div id="import-homeserver">
            <DetailField label="Homeserver to list" value="This Passport’s homeserver" />
          </div>
          {/* Keys for someone who wants to check them; nobody is expected to read them. */}
          <details className="text-sm leading-5 text-muted-foreground">
            <summary className="w-fit cursor-pointer rounded-sm font-medium hover:text-foreground">
              Technical details
            </summary>
            <div className="mt-3 flex flex-col gap-4 text-foreground">
              <DetailField
                copy={{ ...PUBKY_COPY_TOASTS, value: unpublished }}
                label="Your pubky"
                value={unpublished}
              />
              <DetailField label="Homeserver key" value={defaultHomeserver} />
            </div>
          </details>
        </RecoveryCard>
        {/* An account made through this Passport may still live on a homeserver entered at signup
            or named by its invite, so the question is about the homeserver, not the Passport. */}
        <Notice className={TEXT_MEASURE} id="import-homeserver-warning" tone="warning">
          Continue only if you signed up here without entering a different homeserver. If you’re not
          sure, go back: pointing it to the wrong homeserver hides your profile and data from apps.
        </Notice>
        {formError ? (
          <Notice className={TEXT_MEASURE} focusOnMount tone="error">
            {formError.message}
          </Notice>
        ) : null}
        <PassportNavigation
          className="mt-auto md:mt-0"
          back={
            <BackButton
              disabled={pending}
              onClick={() => {
                importer.current?.discardPending();
                setError(undefined);
                setUnpublished(undefined);
              }}
            />
          }
          confirm={
            <Button
              aria-describedby="import-homeserver import-homeserver-warning"
              className="w-full"
              loading={pending}
              onClick={() => void republish(defaultHomeserver)}
              size="lg"
            >
              <ArrowRightIcon />
              {pending ? "Reconnecting…" : "Reconnect and import"}
            </Button>
          }
        />
      </RecoveryScreen>
    );
  }

  return (
    <RecoveryScreen
      title="Import"
      accent="recovery file."
      description="Use your encrypted recovery file to restore your identity in this browser."
    >
      <form
        className="flex flex-1 flex-col gap-6 md:gap-8"
        onSubmit={(event) => void submit(event)}
      >
        <RecoveryCard illustration="/illustrations/file.png">
          <div className="flex flex-col gap-2">
            <Label htmlFor="passport-backup">Recovery file</Label>
            <FileField
              accept=".pkarr,application/octet-stream"
              aria-describedby={fileError ? "passport-backup-error" : undefined}
              aria-invalid={fileError ? true : undefined}
              defaultFile={keptFile}
              disabled={pending}
              id="passport-backup"
              onChange={() => setError(undefined)}
              ref={fileInput}
            />
            {fileError ? (
              <FieldMessage error id="passport-backup-error" role="alert">
                {fileError}
              </FieldMessage>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="passport-backup-password">Recovery file password</Label>
            <Input
              aria-describedby={passwordError ? "passport-backup-password-error" : undefined}
              aria-invalid={passwordError ? true : undefined}
              autoComplete="current-password"
              containerClassName="border-dashed"
              id="passport-backup-password"
              maxLength={MAXIMUM_BACKUP_PASSWORD_LENGTH}
              onInput={() => setError(undefined)}
              readOnly={pending}
              ref={passwordInput}
              type={passwordShown ? "text" : "password"}
              {...REVEALABLE_PASSWORD_INPUT_PROPS}
              action={
                <RevealPasswordButton
                  controls="passport-backup-password"
                  onToggle={() => setPasswordShown((shown) => !shown)}
                  shown={passwordShown}
                />
              }
            />
            {passwordError ? (
              <FieldMessage error id="passport-backup-password-error" role="alert">
                {passwordError}
              </FieldMessage>
            ) : null}
          </div>
        </RecoveryCard>
        {formError ? (
          <Notice className={TEXT_MEASURE} focusOnMount tone="error">
            {formError.message}
            {existing && onSelectExisting ? (
              <Button onClick={() => onSelectExisting(existing)} size="sm" variant="secondary">
                Use this identity
              </Button>
            ) : null}
            {formError.retry ? (
              // Sends the kept file and password again.
              <Button loading={pending} size="sm" type="submit" variant="secondary">
                <RotateCcwIcon />
                Try again
              </Button>
            ) : null}
          </Notice>
        ) : null}
        <PassportNavigation
          className="mt-auto md:mt-0"
          back={<BackButton disabled={pending} onClick={onBack} />}
          confirm={
            <Button className="w-full" loading={pending} size="lg" type="submit">
              <ArrowRightIcon />
              {pending ? "Importing…" : "Import recovery file"}
            </Button>
          }
        />
      </form>
    </RecoveryScreen>
  );
}

/** `fileRestored`: the form holds the file sent last, so only its password is needed again. */
function importError(
  { code, publicKeyZ32 }: BackupImportFailure,
  fileRestored = false,
): ImportError {
  switch (code) {
    case "invalid_backup":
      // The file does not start like a recovery file, so no password could open it.
      return {
        target: "file",
        message: "This isn’t a recovery file. Choose the file whose name ends in .pkarr.",
      };
    case "invalid_password":
      return { target: "password", message: "Enter the password of this recovery file." };
    case "backup_decryption_failed":
      // A typo is far more likely than a damaged file, so that comes first.
      return {
        target: "password",
        message:
          "That password doesn’t open this recovery file. Passwords are case-sensitive, so check for typos and caps lock. If it’s right, the file may be damaged.",
      };
    case "already_present":
      return {
        target: "form",
        message: "This pubky is already saved in this browser, so there is nothing to import.",
        ...(publicKeyZ32 ? { existing: publicKeyZ32 } : {}),
      };
    case "external_key":
      return {
        target: "form",
        message:
          "This pubky is linked to Pubky Ring in this browser. Remove that entry before importing its key.",
      };
    case "signin_failed":
      return {
        target: "form",
        message:
          "Your recovery file opened, but Passport couldn’t sign in to its account. The homeserver may be down, or the account may no longer exist. Check your connection and try again.",
        retry: true,
      };
    case "resolution_failed":
      return {
        target: "form",
        message:
          "Your recovery file opened, but Passport couldn’t look up which homeserver holds its account. Check your connection and try again.",
        retry: true,
      };
    case "homeserver_record_found":
      return {
        target: "form",
        message: `The Pubky network now lists a homeserver for this account, so Passport changed nothing. ${
          fileRestored ? "Enter the password again" : "Choose the file and enter its password again"
        } to import it with that homeserver.`,
      };
    case "publish_failed":
      return {
        target: "form",
        message:
          "Passport couldn’t list the homeserver for this account. Check your connection and try again.",
      };
    case "storage_failed":
      return {
        target: "form",
        message:
          "Your recovery file opened, but this browser couldn’t save the identity. Allow site data for this site (or free up space), then try again.",
      };
    case "import_unavailable":
      return { target: "form", message: "Passport could not import this recovery file." };
  }
}

/** Loads the importer, and with it the Pubky SDK, only once the import screen opens. */
async function createBackupImporter(): Promise<ImportPort> {
  const { BackupImporter } = await import("@/client/logic/backup/BackupImporter");
  return new BackupImporter();
}
