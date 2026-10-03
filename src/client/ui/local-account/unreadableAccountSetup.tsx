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
 * A damaged record comes back on every visit, so removing it is the way on, offered as the
 * screen's action. When storage itself is blocked, only allowing site data helps.
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
      setError(
        "Passport couldn’t remove the saved setup because this browser blocked the change. Allow site data for this site, then try again.",
      );
      return;
    }
    setConfirming(false);
    onBack();
  };

  return (
    <>
      <ErrorScreen
        accent="unavailable."
        action={
          removable ? (
            <Button
              className="w-full"
              onClick={() => {
                setError(undefined);
                setConfirming(true);
              }}
              size="lg"
              variant="secondary"
            >
              <TrashIcon />
              Remove saved setup…
            </Button>
          ) : undefined
        }
        back={<BackButton onClick={onBack} />}
        cause={
          removable
            ? "The account setup saved in this browser is damaged, so Passport can’t continue it."
            : "Passport can’t read this browser’s storage. This happens in a private window or when site data is blocked for this site."
        }
        nextStep={
          removable
            ? "To start again, remove the saved setup. If it already created an account, the recovery file you downloaded can still restore it with Import recovery file."
            : "Allow site data for this site, then go back and choose Create account again."
        }
        title="Setup"
      />
      <ConfirmDeletionDialog
        confirmLabel="Remove key and setup"
        description="The saved key may already own an account. Without its recovery file, that account can’t be recovered after removal."
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
