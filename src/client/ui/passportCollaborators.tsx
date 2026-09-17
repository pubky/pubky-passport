"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";

import type { PassportAuthorizationController } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import {
  GoogleIdentityController,
  type GoogleIdentityViewState,
} from "@/client/logic/google-identity/GoogleIdentityController";
import { LocalIdentityController } from "@/client/logic/local-identity/LocalIdentityController";

export type IdentitySetup = (props: {
  forAuthorization?: boolean;
  onBack?: () => void;
  onComplete: () => void;
}) => ReactNode;

/** The controller surface each screen consumes; fakes in `test-utils/` implement these ports. */
export type AuthorizationControllerPort = Pick<
  PassportAuthorizationController,
  "approve" | "cancel" | "dispose" | "getState" | "subscribe"
>;

export type GoogleIdentityControllerPort = Pick<
  GoogleIdentityController,
  | "clearPinnedGoogleSubject"
  | "detachIdentity"
  | "dispose"
  | "establishIdentity"
  | "replaceInvalidPassportFile"
>;

export type LocalIdentityControllerPort = Pick<
  LocalIdentityController,
  | "createPubkyRingMigration"
  | "createRecoveryFile"
  | "listIdentities"
  | "removeIdentity"
  | "resolveHomeserver"
  | "selectIdentity"
  | "subscribeToIdentityChanges"
>;

export type PassportCollaborators = {
  createAuthorizationController?: () => AuthorizationControllerPort;
  createGoogleIdentityController: (
    googleClientId: string,
    homegateBaseUrl: string,
    onState: (state: GoogleIdentityViewState) => void,
  ) => GoogleIdentityControllerPort;
  createLocalIdentityController: () => LocalIdentityControllerPort;
  IdentitySetup?: IdentitySetup;
};

const DEFAULT_PASSPORT_COLLABORATORS: PassportCollaborators = {
  createGoogleIdentityController: (googleClientId, homegateBaseUrl, onState) =>
    new GoogleIdentityController(googleClientId, homegateBaseUrl, onState),
  createLocalIdentityController: () => new LocalIdentityController(),
};

const PassportCollaboratorsContext = createContext(DEFAULT_PASSPORT_COLLABORATORS);

/**
 * Supplies screen-scoped controller factories. Production pages omit this
 * provider and use the default constructors. Tests pass fakes instead of
 * mocking those module paths. Authorization stays off the default value so
 * the dashboard graph does not load the authorization controller.
 */
function PassportCollaboratorsProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: Partial<PassportCollaborators>;
}) {
  const collaborators = useMemo(() => ({ ...DEFAULT_PASSPORT_COLLABORATORS, ...value }), [value]);
  return (
    <PassportCollaboratorsContext value={collaborators}>{children}</PassportCollaboratorsContext>
  );
}

function usePassportCollaborators(): PassportCollaborators {
  return useContext(PassportCollaboratorsContext);
}

export { PassportCollaboratorsProvider, usePassportCollaborators };
