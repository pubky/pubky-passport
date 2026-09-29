"use client";

import { Result, type Result as ResultType } from "better-result";
import { useState } from "react";

import { LocalAccountDraftRepository } from "@/client/logic/local-account/LocalAccountDraftRepository";
import { BackButton } from "@/client/ui/shared/backButton";
import { ConfirmDeletionDialog } from "@/client/ui/shared/confirmDeletionDialog";
import { ErrorScreen } from "@/client/ui/shared/errorScreen";
import { TrashIcon } from "@/client/ui/shared/icons";
import { Button } from "@/client/ui/shared/primitives/button";

/**
 * Shown when the saved account setup cannot be read. Its key may already own an account, so the
 * setup is kept unless the person confirms removing it; otherwise it would block new accounts.
 */
export function UnreadableAccountSetup({
  removable,
  onBack,
  removeSetup = () => new LocalAccountDraftRepository().removeUnreadable(),
}: {
  /** False when browser storage itself failed; removing the record cannot help then. */
  removable: boolean;
  onBack: () => void;
  removeSetup?: () => ResultType<void, unknown>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  const remove = () => {
    if (Result.isError(removeSetup())) {
      setError("Passport could not remove the saved setup. Try again.");
      return;
    }
    setConfirming(false);
    onBack();
  };

  return (
    <>
      <ErrorScreen
        accent="unavailable."
        back={<BackButton onClick={onBack} />}
        cause="Passport could not read your saved account setup."
        nextStep="Your saved key has been kept. Go back and try again."
        secondaryAction={
          removable ? (
            <Button
              onClick={() => {
                setError(undefined);
                setConfirming(true);
              }}
              variant="linkDestructive"
            >
              <TrashIcon />
              Remove saved setup
            </Button>
          ) : null
        }
        title="Setup"
      />
      <ConfirmDeletionDialog
        confirmLabel="Remove key and setup"
        description="The saved key may already own an account. Without a downloaded backup of it, that account cannot be recovered after removal."
        error={error}
        id="remove-unreadable-setup"
        onCancel={() => {
          setError(undefined);
          setConfirming(false);
        }}
        onConfirm={remove}
        open={confirming}
        title="Remove saved setup?"
      />
    </>
  );
}
