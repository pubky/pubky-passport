"use client";

import { useReducer } from "react";

import type { GoogleIdentityConfiguration } from "../../../logic/google-identity/GoogleIdentityFlow";
import type { LocalIdentityCatalog } from "../../../logic/local-identity/localIdentityModels";
import { SignInFlow } from "../../onboarding/signInFlow";
import type { GoogleIdentityEstablished } from "../../onboarding/google/useGoogleSignIn";
import { IdentitySwitcher } from "./identitySwitcher";
import { transitionIdentitySelection } from "./identitySelectionState";

function IdentitySelectionFlow({ catalog, googleIdentityConfiguration, onBack, onIdentityEstablished, onIdentitySelected, selectIdentity }: {
  catalog: LocalIdentityCatalog;
  googleIdentityConfiguration: GoogleIdentityConfiguration;
  onBack: () => void;
  onIdentityEstablished?: (identity: GoogleIdentityEstablished) => void;
  onIdentitySelected: () => void;
  selectIdentity: (publicKeyZ32: string) => boolean;
}) {
  const [state, dispatch] = useReducer(transitionIdentitySelection, { view: "selection" });

  if (state.view === "add-identity") {
    return <SignInFlow
      googleIdentityConfiguration={googleIdentityConfiguration}
      onBack={() => dispatch({ type: "add-cancelled" })}
      onComplete={onIdentitySelected}
      {...(onIdentityEstablished ? { onEstablished: onIdentityEstablished } : {})}
    />;
  }

  return <IdentitySwitcher
    activePublicKeyZ32={catalog.activePublicKeyZ32}
    identities={catalog.identities}
    onAddIdentity={() => dispatch({ type: "add-requested" })}
    onBack={onBack}
    onSelect={(publicKeyZ32) => {
      if (selectIdentity(publicKeyZ32)) onIdentitySelected();
    }}
  />;
}

export { IdentitySelectionFlow };
