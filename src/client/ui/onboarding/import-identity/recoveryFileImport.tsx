import { Result } from "better-result";
import { useEffect, useRef, useState } from "react";

import {
  MAXIMUM_RECOVERY_FILE_BYTES,
  RECOVERY_FILE_EXTENSION,
} from "@/client/logic/identity-import/recoveryFile";
import type { LocalIdentityImportErrorCode } from "@/client/logic/local-identity/LocalIdentityController";
import { BackButton } from "@/client/ui/shared/backButton";
import { FolderIcon, RotateCcwIcon } from "@/client/ui/shared/icons";
import { PassportNavigation } from "@/client/ui/shared/passportNavigation";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";
import { Input } from "@/client/ui/shared/primitives/input";
import { Label } from "@/client/ui/shared/primitives/label";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { importErrorMessage } from "./importErrorMessage";
import type { ImportIdentity, ImportedIdentityHandler } from "./importIdentityTypes";
import { RecoveredPubky } from "./recoveredPubky";

type FileProblem = "wrong-extension" | "too-large" | "unreadable";

/**
 * Recovery file and password, after pubky.app's encrypted file dialog. The file is read and
 * decrypted in this browser only; it is never uploaded.
 */
function RecoveryFileImport({
  importIdentity,
  onBack,
  onImported,
}: {
  importIdentity: ImportIdentity;
  onBack: () => void;
  onImported: ImportedIdentityHandler;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [fileProblem, setFileProblem] = useState<FileProblem | null>(null);
  const [failure, setFailure] = useState<LocalIdentityImportErrorCode | null>(null);
  const [pending, setPending] = useState(false);
  const [recoveredPubky, setRecoveredPubky] = useState<string | null>(null);
  const active = useRef(true);
  const ready = file !== null && password.length > 0 && !pending;

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  function edited() {
    setFailure(null);
    setRecoveredPubky(null);
  }

  function selectFile(selected: File | undefined) {
    edited();
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(RECOVERY_FILE_EXTENSION)) {
      setFile(null);
      setFileProblem("wrong-extension");
      return;
    }
    if (selected.size > MAXIMUM_RECOVERY_FILE_BYTES) {
      setFile(null);
      setFileProblem("too-large");
      return;
    }
    setFileProblem(null);
    setFile(selected);
  }

  async function restore() {
    if (!ready) return;
    setPending(true);
    edited();
    // A problem from an earlier read must not hide what this attempt reports.
    setFileProblem(null);
    try {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        if (active.current) setFileProblem("unreadable");
        return;
      }
      const result = await importIdentity(
        { kind: "recovery-file", bytes, password },
        (publicIdentity) => {
          if (active.current) setRecoveredPubky(publicIdentity.publicKeyZ32);
        },
      );
      if (!active.current) return;
      if (Result.isError(result)) {
        setFailure(result.error.code);
        return;
      }
      setPassword("");
      onImported(result.value);
    } catch {
      if (active.current) setFailure("import_failed");
    } finally {
      if (active.current) setPending(false);
    }
  }

  const message = fileProblem
    ? fileProblemMessage(fileProblem)
    : failure
      ? importErrorMessage(failure)
      : null;
  const passwordInvalid = fileProblem === null && failure === "recovery_file_undecryptable";

  return (
    <PassportScreen className="gap-6">
      <div className="flex flex-col gap-6">
        <DisplayHeading accent="file." aria-label="Recovery file.">
          Recovery
        </DisplayHeading>
        <LeadText>Use your recovery file to restore your pubky and sign in.</LeadText>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="leading-5" htmlFor="import-recovery-file">
          Recovery file
        </Label>
        <div className="flex h-14 items-center gap-3 rounded-lg border border-dashed border-input bg-black/10 pl-4 pr-2">
          <span
            className={
              file
                ? "min-w-0 flex-1 truncate font-medium text-foreground"
                : "min-w-0 flex-1 truncate font-medium text-muted-foreground"
            }
            title={file?.name}
            translate="no"
          >
            {file?.name ?? "No file selected"}
          </span>
          <Button
            disabled={pending}
            onClick={() => fileInput.current?.click()}
            size="sm"
            variant="secondary"
          >
            <FolderIcon />
            Select file
          </Button>
        </div>
        <input
          accept={RECOVERY_FILE_EXTENSION}
          className="hidden"
          disabled={pending}
          id="import-recovery-file"
          onChange={(event) => {
            selectFile(event.currentTarget.files?.[0]);
            // Choosing the same file again after an error still fires a change.
            event.currentTarget.value = "";
          }}
          ref={fileInput}
          type="file"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label className="leading-5" htmlFor="import-recovery-file-password">
          Password
        </Label>
        <Input
          aria-describedby={passwordInvalid ? "import-recovery-file-message" : undefined}
          aria-invalid={passwordInvalid || undefined}
          autoComplete="current-password"
          containerClassName="h-14 border-dashed"
          disabled={pending}
          id="import-recovery-file-password"
          maxLength={1024}
          onChange={(event) => {
            edited();
            setPassword(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void restore();
            }
          }}
          placeholder="Enter your password"
          spellCheck={false}
          type="password"
          value={password}
        />
        {message ? (
          <FieldMessage error id="import-recovery-file-message">
            {message}
          </FieldMessage>
        ) : null}
      </div>

      {recoveredPubky ? <RecoveredPubky pending={pending} publicKeyZ32={recoveredPubky} /> : null}

      <PassportNavigation
        back={<BackButton disabled={pending} onClick={onBack} />}
        className="mt-auto pt-2"
        confirm={
          <Button
            className="w-full"
            disabled={!ready}
            onClick={() => {
              void restore();
            }}
            size="lg"
          >
            <RotateCcwIcon />
            {pending ? "Restoring…" : "Restore"}
          </Button>
        }
      />
    </PassportScreen>
  );
}

function fileProblemMessage(problem: FileProblem): string {
  switch (problem) {
    case "wrong-extension":
      return "Please select a .pkarr file.";
    case "too-large":
      return "This file is too large to be a recovery file. Please select a .pkarr file.";
    case "unreadable":
      return "Could not read this file. Please select it again.";
  }
}

export { RecoveryFileImport };
