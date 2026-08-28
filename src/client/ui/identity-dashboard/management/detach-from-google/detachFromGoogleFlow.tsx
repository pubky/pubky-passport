import { useState } from "react";
import { preload } from "react-dom";

import type { LocalIdentityRecoveryFileResult } from "../../../../logic/local-identity/LocalIdentityController";
import type { LocalIdentityResult } from "../../../../logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityMetadata } from "../../../../logic/local-identity/localIdentityModels";
import { PubkyRingMigration } from "../../../../logic/pubky/PubkySdkAdapter";
import { RecoveryFileDownload } from "../recovery-file/recoveryFileDownload";
import { MigrateToPubkyRing } from "../migrate-to-pubky-ring/migrateToPubkyRing";
import { RecoveryBeforeDetaching } from "./recoveryBeforeDetaching";
import { ConfirmGoogleDetachment } from "./confirmGoogleDetachment";
import { GoogleDetachmentComplete } from "./googleDetachmentComplete";
import { ReviewGoogleDetachment } from "./reviewGoogleDetachment";
import { useDetachFromGoogle } from "./useDetachFromGoogle";

type DetachFromGoogleView =
  | { view: "recovery-options" }
  | { view: "recovery-file" }
  | { view: "pubky-ring" }
  | { view: "review"; confirmation: "closed" | "open" };

function DetachFromGoogleFlow({ createRecoveryFile, createMigration, googleSubject, identity, onBack, onDone }: {
  createRecoveryFile: (publicKeyZ32: string, password: string) => Promise<LocalIdentityRecoveryFileResult>;
  createMigration: () => LocalIdentityResult<PubkyRingMigration>;
  googleSubject: string;
  identity: LocalIdentityMetadata;
  onBack: () => void;
  onDone: () => void;
}) {
  const [state, setState] = useState<DetachFromGoogleView>({ view: "recovery-options" });
  const operation = useDetachFromGoogle(
    identity.publicIdentity,
    googleSubject,
  );

  preload("/illustrations/cloud.png", { as: "image" });
  preload("/illustrations/red-line.svg", { as: "image" });
  if (state.view === "review") preload("/illustrations/checkmark.png", { as: "image" });

  if (operation.state.status === "complete") return <GoogleDetachmentComplete onDone={onDone} />;

  switch (state.view) {
    case "recovery-file":
      return <RecoveryFileDownload
        createRecoveryFile={createRecoveryFile}
        publicKeyZ32={identity.publicIdentity.publicKeyZ32}
        onBack={() => setState({ view: "recovery-options" })}
      />;
    case "pubky-ring":
      return <MigrateToPubkyRing
        createMigration={createMigration}
        navigationAction="continue"
        onBack={() => setState({ view: "recovery-options" })}
      />;
    case "review": {
      const pending = operation.state.status === "requesting-authorization"
        || operation.state.status === "detaching";
      return (
        <>
          <ReviewGoogleDetachment onBack={() => setState({ view: "recovery-options" })} onRemove={() => setState({ view: "review", confirmation: "open" })} />
          <ConfirmGoogleDetachment
            canConfirm={operation.state.status === "ready" || operation.state.status === "operation-failed"}
            canRetryAuthorization={operation.state.status === "authorization-failed"}
            error={operation.state.status === "authorization-failed"
              ? "authorization_failed"
              : operation.state.status === "operation-failed"
                ? operation.state.error.code
                : null}
            onCancel={() => setState({ view: "review", confirmation: "closed" })}
            onConfirm={operation.detach}
            onRetryAuthorization={operation.retryDetachment}
            open={state.confirmation === "open"}
            pending={pending}
          />
        </>
      );
    }
    case "recovery-options":
      return <RecoveryBeforeDetaching
        onBack={onBack}
        onRecoveryConfirmed={() => setState({ view: "review", confirmation: "closed" })}
        onDownloadRecoveryFile={() => setState({ view: "recovery-file" })}
        onMigrateToKeychain={() => setState({ view: "pubky-ring" })}
      />;
  }
}

export { DetachFromGoogleFlow };
