"use client";

import { Result } from "better-result";
import { useReducer } from "react";

import type {
  PassportIdentityController,
  PassportIdentityList,
} from "../../../browser/identity/passportIdentity";
import { SignInFlow } from "../../onboarding/signInFlow";
import { IdentitySwitcher } from "./identitySwitcher";
import { transitionIdentitySelection } from "./identitySelectionState";

function IdentitySelectionFlow({ catalog, controller, onBack, onIdentitySelected }: {
  catalog: PassportIdentityList;
  controller: PassportIdentityController;
  onBack: () => void;
  onIdentitySelected: () => void;
}) {
  const [state, dispatch] = useReducer(transitionIdentitySelection, { view: "selection" });

  if (state.view === "add-identity") {
    return <SignInFlow
      controller={controller}
      onBack={() => dispatch({ type: "add-cancelled" })}
      onComplete={onIdentitySelected}
    />;
  }

  return <IdentitySwitcher
    activeIdentityId={catalog.activeIdentityId}
    identities={catalog.identities}
    onAddIdentity={() => dispatch({ type: "add-requested" })}
    onBack={onBack}
    onSelect={(identityId) => {
      const selected = controller.select(identityId);
      if (Result.isOk(selected)) onIdentitySelected();
    }}
  />;
}

export { IdentitySelectionFlow };
