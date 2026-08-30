import { Result } from "better-result";
import { useState } from "react";

import type { LocalIdentityResult } from "../../../logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityCatalog } from "../../../logic/local-identity/localIdentityModels";
import { IdentityEstablishmentFlow } from "../../onboarding/identityEstablishmentFlow";
import { IdentitySwitcher } from "./identitySwitcher";

function IdentitySelectionFlow({
  catalog,
  onBack,
  onIdentitySelected,
  selectIdentity,
  signInTo,
}: {
  catalog: LocalIdentityCatalog;
  onBack: () => void;
  onIdentitySelected: () => void;
  selectIdentity: (publicKeyZ32: string) => LocalIdentityResult<void>;
  signInTo?: string;
}) {
  const [view, setView] = useState<"selection" | "add-identity">("selection");
  const [selectionFailed, setSelectionFailed] = useState(false);

  if (view === "add-identity") {
    return (
      <IdentityEstablishmentFlow
        onBack={() => setView("selection")}
        onComplete={onIdentitySelected}
        {...(signInTo ? { signInTo } : {})}
      />
    );
  }

  return (
    <IdentitySwitcher
      activePublicKeyZ32={catalog.activePublicKeyZ32}
      addIdentityLabel={signInTo ? "Use other identity" : "Add identity"}
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
