"use client";

import { Result } from "better-result";
import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { BackupImporter, BackupImportErrorCode } from "@/client/logic/backup/BackupImporter";
import {
  MAXIMUM_BACKUP_BYTES,
  MAXIMUM_BACKUP_PASSWORD_LENGTH,
} from "@/client/logic/backup/BackupVerifier";
import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { BackButton } from "@/client/ui/shared/backButton";
import { DetailField } from "@/client/ui/shared/detailField";
import { ArrowRightIcon } from "@/client/ui/shared/icons";
import { Notice } from "@/client/ui/shared/notice";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { RecoveryScreen } from "@/client/ui/shared/recoveryScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { Input } from "@/client/ui/shared/primitives/input";
import { Label } from "@/client/ui/shared/primitives/label";

type ImportError = { target: "file" | "password" | "form"; message: string };
type ImportPort = Pick<
  BackupImporter,
  "discardPending" | "dispose" | "importBackup" | "republishHomeserver"
>;

export function BackupImportFlow({
  defaultHomeserver,
  onBack,
  onComplete,
  createImporter = createBackupImporter,
}: {
  /**
   * The instance homeserver, offered when a lookup finds no homeserver record for the backup's
   * identity. Without one, that record cannot be repaired here.
   */
  defaultHomeserver: string | null;
  onBack: () => void;
  onComplete: (identity: LocalIdentityMetadata) => void;
  /** Builds the importer; it may load the Pubky SDK first. */
  createImporter?: () => ImportPort | Promise<ImportPort>;
}) {
  const importer = useRef<ImportPort>(null);
  const [buildImporter] = useState(() => createImporter);
  const fileInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
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
      setError(importError("invalid_backup"));
      return;
    }
    if (!password) {
      setError(importError("invalid_password"));
      return;
    }

    setPending(true);
    setError(undefined);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // The importer may still be loading the Pubky SDK when the form is sent.
      const ready = importer.current ?? (await importerReady.current);
      const imported = await ready?.importBackup(bytes, password, defaultHomeserver);
      if (passwordInput.current) passwordInput.current.value = "";
      if (!imported || Result.isError(imported)) {
        bytes.fill(0);
        setError(importError(imported ? imported.error.code : "import_unavailable"));
        return;
      }
      if (imported.value.status === "homeserver_record_missing") {
        setUnpublished(imported.value.publicIdentity.publicKeyZ32);
        return;
      }
      onComplete(imported.value.identity);
    } catch {
      setError({
        target: "form",
        message: "Passport could not read that backup. Try selecting it again.",
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
        const code = imported ? imported.error.code : "import_unavailable";
        if (code === "homeserver_record_found") {
          // The importer released the key; importing the backup again signs in with that record.
          setFileName("");
          setUnpublished(undefined);
        }
        setError(importError(code));
        return;
      }
      onComplete(imported.value);
    } catch {
      setError(importError("publish_failed"));
    } finally {
      setPending(false);
    }
  };

  const fileError = error?.target === "file" ? error.message : undefined;
  const passwordError = error?.target === "password" ? error.message : undefined;
  const formError = error?.target === "form" ? error.message : undefined;

  if (unpublished && defaultHomeserver) {
    return (
      <RecoveryScreen
        title="Homeserver record missing."
        description="The backup opened, but the Pubky network has no homeserver record for this identity, so its account cannot be found."
      >
        <p className="break-all text-xs text-muted-foreground">Pubky: {unpublished}</p>
        <p className="text-sm leading-5">
          Passport can publish a new record that points to this homeserver.
        </p>
        <div id="import-homeserver">
          <DetailField label="Homeserver to publish" value={defaultHomeserver} />
        </div>
        {/* Publishing the wrong homeserver sends apps to the wrong place for this pubky's data. */}
        <Notice id="import-homeserver-warning" tone="warning">
          Only continue if your account was created on this homeserver. If it lives anywhere else,
          apps will look for your profile and data in the wrong place. Go back and import it where
          its account was created instead.
        </Notice>
        {formError ? (
          <Notice focusOnMount tone="error">
            {formError}
          </Notice>
        ) : null}
        <PassportNavigation
          back={
            <BackButton
              disabled={pending}
              onClick={() => {
                importer.current?.discardPending();
                setError(undefined);
                setFileName("");
                setUnpublished(undefined);
              }}
            />
          }
          layout="paired"
          confirm={
            <Button
              aria-describedby="import-homeserver import-homeserver-warning"
              className="w-full"
              loading={pending}
              onClick={() => void republish(defaultHomeserver)}
              size="lg"
            >
              <ArrowRightIcon />
              {pending ? "Publishing…" : "Publish record and import"}
            </Button>
          }
        />
      </RecoveryScreen>
    );
  }

  return (
    <RecoveryScreen
      title="Import backup."
      description="Use your encrypted backup file to restore your identity in this browser."
    >
      <form className="flex flex-col gap-6" onSubmit={(event) => void submit(event)}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="passport-backup">Pubky backup</Label>
          <Input
            accept=".pkarr,application/octet-stream"
            aria-describedby={fileError ? "passport-backup-error" : undefined}
            aria-invalid={fileError ? true : undefined}
            containerClassName="border-dashed"
            disabled={pending}
            id="passport-backup"
            onChange={(event) => {
              setFileName(event.currentTarget.files?.[0]?.name ?? "");
              setError(undefined);
            }}
            ref={fileInput}
            type="file"
          />
          {fileName ? <p className="text-xs text-muted-foreground">Selected {fileName}</p> : null}
          {fileError ? (
            <FieldMessage error id="passport-backup-error" role="alert">
              {fileError}
            </FieldMessage>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="passport-backup-password">Backup password</Label>
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
            type="password"
          />
          {passwordError ? (
            <FieldMessage error id="passport-backup-password-error" role="alert">
              {passwordError}
            </FieldMessage>
          ) : null}
        </div>
        {formError ? (
          <Notice focusOnMount tone="error">
            {formError}
          </Notice>
        ) : null}
        <PassportNavigation
          back={<BackButton disabled={pending} onClick={onBack} />}
          layout="paired"
          confirm={
            <Button
              className="w-full"
              disabled={!fileName}
              loading={pending}
              size="lg"
              type="submit"
            >
              <ArrowRightIcon />
              {pending ? "Importing…" : "Import backup"}
            </Button>
          }
        />
      </form>
    </RecoveryScreen>
  );
}

function importError(code: BackupImportErrorCode): ImportError {
  switch (code) {
    case "invalid_backup":
      return { target: "file", message: "Choose a valid .pkarr backup smaller than 1 MB." };
    case "invalid_password":
      return { target: "password", message: "Enter the password used to protect this backup." };
    case "backup_decryption_failed":
      return { target: "password", message: "The password is wrong or this backup is malformed." };
    case "already_present":
      return {
        target: "form",
        message: "This Pubky is already saved in this browser. Select it from your identities.",
      };
    case "external_key":
      return {
        target: "form",
        message:
          "This Pubky is linked to Pubky Ring in this browser. Remove that entry before importing its key.",
      };
    case "signin_failed":
      return {
        target: "form",
        message: "The backup decrypted, but its Pubky account could not be verified.",
      };
    case "resolution_failed":
      return {
        target: "form",
        message:
          "The backup decrypted, but its Pubky account could not be verified. Passport could not look up its homeserver record; check your connection and try again.",
      };
    case "homeserver_record_found":
      return {
        target: "form",
        message:
          "The network now has a homeserver record for this Pubky on another homeserver, so Passport published nothing. Import the backup again to sign in with it.",
      };
    case "publish_failed":
      return {
        target: "form",
        message:
          "Passport could not publish the homeserver record. Check your connection and retry.",
      };
    case "storage_failed":
      return {
        target: "form",
        message: "The identity was verified, but this browser could not save it.",
      };
    case "import_unavailable":
      return { target: "form", message: "Passport could not import this backup." };
  }
}

/** Loads the importer, and with it the Pubky SDK, only once the import screen opens. */
async function createBackupImporter(): Promise<ImportPort> {
  const { BackupImporter } = await import("@/client/logic/backup/BackupImporter");
  return new BackupImporter();
}
