import { Result } from "better-result";
import { useState } from "react";

import type { LocalIdentityResult } from "../../../logic/local-identity/IndexedDbIdentityRepository";
import type { LocalIdentityCatalog } from "../../../logic/local-identity/localIdentityModels";
import { IdentityEstablishmentFlow } from "../../onboarding/identityEstablishmentFlow";
import { IdentitySwitcher } from "./identitySwitcher";

function IdentitySelectionFlow({
  catalog,
  forAuthorization = false,
  onBack,
  onIdentitySelected,
  selectIdentity,
}: {
  catalog: LocalIdentityCatalog;
  forAuthorization?: boolean;
  onBack: () => void;
  onIdentitySelected: () => void;
  selectIdentity: (publicKeyZ32: string) => Promise<LocalIdentityResult<void>>;
}) {
  const [view, setView] = useState<"selection" | "add-identity">("selection");
  const [selectionFailed, setSelectionFailed] = useState(false);
  const [selectionPending, setSelectionPending] = useState(false);

  if (view === "add-identity") {
    return (
      <IdentityEstablishmentFlow
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
      onSelect={async (publicKeyZ32) => {
        setSelectionPending(true);
        const selected = await selectIdentity(publicKeyZ32);
        setSelectionPending(false);
        setSelectionFailed(Result.isError(selected));
        if (Result.isOk(selected)) onIdentitySelected();
      }}
      selectionFailed={selectionFailed}
      selectionPending={selectionPending}
    />
  );
}

export { IdentitySelectionFlow };
