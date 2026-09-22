import { Result } from "better-result";
import { useState } from "react";

import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";
import { IdentityEstablishmentFlow } from "@/client/ui/onboarding/identityEstablishmentFlow";
import { usePassportCollaborators } from "@/client/ui/passportCollaborators";
import { IdentitySwitcher } from "./identitySwitcher";

function IdentitySelectionFlow({
  catalog,
  forAuthorization = false,
  onBack,
  onIdentitySelected,
  selectIdentity,
}: {
  catalog: LocalIdentityCatalog;
  forAuthorization?: boolean | undefined;
  onBack: () => void;
  onIdentitySelected: () => void;
  selectIdentity: (publicKeyZ32: string) => LocalIdentityResult<void>;
}) {
  const { IdentitySetup } = usePassportCollaborators();
  const Setup = IdentitySetup ?? IdentityEstablishmentFlow;
  const [view, setView] = useState<"selection" | "add-identity">("selection");
  const [selectionFailed, setSelectionFailed] = useState(false);

  if (view === "add-identity") {
    return (
      <Setup
        forAuthorization={forAuthorization}
        onBack={() => setView("selection")}
        onComplete={onIdentitySelected}
      />
    );
  }

  return (
    <IdentitySwitcher
      activePublicKeyZ32={catalog.activePublicKeyZ32}
      addIdentityLabel={forAuthorization ? "Use other identity" : "Add identity"}
      identities={catalog.identities}
      onAddIdentity={() => setView("add-identity")}
      onBack={onBack}
      onSelect={(publicKeyZ32) => {
        const selected = selectIdentity(publicKeyZ32);
        setSelectionFailed(Result.isError(selected));
        if (Result.isOk(selected)) onIdentitySelected();
      }}
      selectionFailed={selectionFailed}
    />
  );
}

export { IdentitySelectionFlow };
