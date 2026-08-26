import { useState } from "react";

import type { LocalIdentityCatalog } from "../../../logic/local-identity/localIdentityModels";
import { IdentityEstablishmentFlow } from "../../onboarding/identityEstablishmentFlow";
import { IdentitySwitcher } from "./identitySwitcher";

function IdentitySelectionFlow({ catalog, onBack, onIdentitySelected, selectIdentity }: {
  catalog: LocalIdentityCatalog;
  onBack: () => void;
  onIdentitySelected: () => void;
  selectIdentity: (publicKeyZ32: string) => boolean;
}) {
  const [view, setView] = useState<"selection" | "add-identity">("selection");

  if (view === "add-identity") {
    return <IdentityEstablishmentFlow
      onBack={() => setView("selection")}
      onComplete={onIdentitySelected}
    />;
  }

  return <IdentitySwitcher
    activePublicKeyZ32={catalog.activePublicKeyZ32}
    identities={catalog.identities}
    onAddIdentity={() => setView("add-identity")}
    onBack={onBack}
    onSelect={(publicKeyZ32) => {
      if (selectIdentity(publicKeyZ32)) onIdentitySelected();
    }}
  />;
}

export { IdentitySelectionFlow };
