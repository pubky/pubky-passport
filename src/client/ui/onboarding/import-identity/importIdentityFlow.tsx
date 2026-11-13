"use client";

import { useEffect, useState } from "react";

import type { LocalIdentityImport } from "@/client/logic/local-identity/LocalIdentityController";
import { usePassportCollaborators } from "@/client/ui/passportCollaborators";
import { ImportChoice } from "./importChoice";
import { ImportComplete } from "./importComplete";
import type { ImportIdentity } from "./importIdentityTypes";
import { RecoveryFileImport } from "./recoveryFileImport";
import { RecoveryPhraseImport } from "./recoveryPhraseImport";

type ImportView =
  | { step: "choice" | "recovery-phrase" | "recovery-file" }
  | { step: "complete"; imported: LocalIdentityImport };

/**
 * Imports a pubky someone already has, from its recovery phrase or recovery file. Only existing
 * identities: there is no signup and no homeserver choice. The identity is kept in this browser
 * only, like a detached one.
 */
function ImportIdentityFlow({
  onBack,
  onComplete,
}: {
  onBack: () => void;
  onComplete: () => void;
}) {
  const { createLocalIdentityController } = usePassportCollaborators();
  const [importIdentity] = useState(() => {
    const controller = createLocalIdentityController();
    const run: ImportIdentity = (source, onKeyRecovered) =>
      controller.importIdentity(source, onKeyRecovered);
    return run;
  });
  const [view, setView] = useState<ImportView>({ step: "choice" });

  // Each step is a new screen; start it at the top, as a page change would.
  useEffect(() => {
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  }, [view.step]);

  const onImported = (imported: LocalIdentityImport) => setView({ step: "complete", imported });
  const backToChoice = () => setView({ step: "choice" });

  switch (view.step) {
    case "choice":
      return (
        <ImportChoice
          onBack={onBack}
          onRecoveryFile={() => setView({ step: "recovery-file" })}
          onRecoveryPhrase={() => setView({ step: "recovery-phrase" })}
        />
      );
    case "recovery-phrase":
      return (
        <RecoveryPhraseImport
          importIdentity={importIdentity}
          onBack={backToChoice}
          onImported={onImported}
        />
      );
    case "recovery-file":
      return (
        <RecoveryFileImport
          importIdentity={importIdentity}
          onBack={backToChoice}
          onImported={onImported}
        />
      );
    case "complete":
      return <ImportComplete imported={view.imported} onContinue={onComplete} />;
  }
}

export { ImportIdentityFlow };
