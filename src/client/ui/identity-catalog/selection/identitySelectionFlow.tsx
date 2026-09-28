import { Result } from "better-result";
import { useEffect, useState } from "react";

import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";
import { IdentitySwitcher } from "./identitySwitcher";

function IdentitySelectionFlow({
  catalog,
  onAddIdentity,
  onBack,
  onIdentitySelected,
  onShow,
  selectIdentity,
}: {
  catalog: LocalIdentityCatalog;
  onAddIdentity: () => void;
  onBack: () => void;
  onIdentitySelected: () => void;
  /** Called once the list is on screen, e.g. to load every identity's profile. */
  onShow?: (() => void) | undefined;
  selectIdentity: (publicKeyZ32: string) => LocalIdentityResult<void>;
}) {
  const [selectionFailed, setSelectionFailed] = useState(false);
  useEffect(() => {
    onShow?.();
  }, [onShow]);

  return (
    <IdentitySwitcher
      activePublicKeyZ32={catalog.activePublicKeyZ32}
      identities={catalog.identities}
      onAddIdentity={onAddIdentity}
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
