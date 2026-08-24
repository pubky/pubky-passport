"use client";

import { useState } from "react";

import { TrashIcon } from "../../shared/actionIcons";
import { BackButton } from "../../shared/backButton";
import { ConfirmDeletionDialog } from "../../shared/confirmDeletionDialog";
import { PassportScreen } from "../../shared/passportScreen";
import { Button } from "../../shared/primitives/button";
import { FieldMessage } from "../../shared/primitives/fieldMessage";
import { DisplayHeading, LeadText } from "../../shared/primitives/typography";

function InvalidGoogleDrivePassportFile({ deletionFailed, onBack, onReplace }: {
  deletionFailed: boolean;
  onBack: () => void;
  onReplace: () => void;
}) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  return (
    <>
      <PassportScreen className="gap-6">
        <div className="flex flex-col gap-6">
          <DisplayHeading accent="can't be restored." aria-label="Identity file can't be restored.">Identity file</DisplayHeading>
          <LeadText>Passport found your encrypted identity file in Google Drive, but the file is damaged and cannot be restored.</LeadText>
          <div className="rounded-md bg-destructive-surface px-4 py-3 text-sm font-medium leading-5 text-destructive-foreground">
            Replacing this file is permanent. Unless you have another recovery copy, you will lose access to your current Pubky identity. Passport will create a new identity automatically.
          </div>
          {deletionFailed ? (
            <FieldMessage error>Passport could not delete the invalid identity file. Please try again.</FieldMessage>
          ) : null}
        </div>

        <div className="mt-auto flex flex-col gap-3">
          <Button className="w-full" onClick={() => setConfirmationOpen(true)} size="lg" type="button" variant="destructive">
            <TrashIcon />Delete file and create new identity
          </Button>
          <BackButton onClick={onBack} />
        </div>
      </PassportScreen>

      <ConfirmDeletionDialog
        confirmLabel="Delete and create new identity"
        description="Passport will delete the invalid file from Google Drive and automatically create a new Pubky identity. This cannot be undone."
        id="replace-invalid-passport-file"
        onCancel={() => setConfirmationOpen(false)}
        onConfirm={onReplace}
        open={confirmationOpen}
        title="Permanently replace identity?"
      />
    </>
  );
}

export { InvalidGoogleDrivePassportFile };
