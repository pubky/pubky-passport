"use client";

import { Result } from "better-result";
import { useReducer } from "react";

import type {
  PassportIdentityController,
  LocalIdentityCatalog,
} from "../../../logic/identity/PassportIdentityController";
import { SignInFlow } from "../../onboarding/signInFlow";
import type { GoogleIdentityEstablished } from "../../onboarding/google/useGoogleSignIn";
import { IdentitySwitcher } from "./identitySwitcher";
import { transitionIdentitySelection } from "./identitySelectionState";

function IdentitySelectionFlow({ catalog, controller, onBack, onIdentityEstablished, onIdentitySelected }: {
  catalog: LocalIdentityCatalog;
  controller: PassportIdentityController;
  onBack: () => void;
  onIdentityEstablished?: (identity: GoogleIdentityEstablished) => void;
  onIdentitySelected: () => void;
}) {
  const [state, dispatch] = useReducer(transitionIdentitySelection, { view: "selection" });

  if (state.view === "add-identity") {
    return <SignInFlow
      controller={controller}
      onBack={() => dispatch({ type: "add-cancelled" })}
      onComplete={onIdentitySelected}
      {...(onIdentityEstablished ? { onEstablished: onIdentityEstablished } : {})}
    />;
  }

  return <IdentitySwitcher
    activeIdentityId={catalog.activeIdentityId}
    identities={catalog.identities}
    onAddIdentity={() => dispatch({ type: "add-requested" })}
    onBack={onBack}
    onSelect={(identityId) => {
      const selected = controller.selectIdentity(identityId);
      if (Result.isOk(selected)) onIdentitySelected();
    }}
  />;
}

export { IdentitySelectionFlow };
