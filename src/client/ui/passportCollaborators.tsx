"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";

import {
  AppleIdentityController,
  type AppleIdentityConfiguration,
} from "@/client/logic/apple-identity/AppleIdentityController";
import type { PassportAuthorizationController } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import { GoogleIdentityController } from "@/client/logic/google-identity/GoogleIdentityController";
import { GoogleRedirectAuthorization } from "@/client/logic/google-identity/gia/GoogleRedirectAuthorization";
import { LocalIdentityController } from "@/client/logic/local-identity/LocalIdentityController";

export type IdentitySetup = (props: {
  forAuthorization?: boolean | undefined;
  onBack?: (() => void) | undefined;
  onComplete: () => void;
}) => ReactNode;

/** The controller surface each screen consumes; fakes in `test-utils/` implement these ports. */
export type AuthorizationControllerPort = Pick<
  PassportAuthorizationController,
  "approve" | "cancel" | "dispose" | "getState" | "subscribe"
>;

export type GoogleIdentityControllerPort = Pick<
  GoogleIdentityController,
  | "detachIdentity"
  | "dispose"
  | "establishIdentity"
  | "continueWithoutVisibleBackup"
  | "getState"
  | "replaceInvalidPassportFile"
  | "replaceUndecryptablePassportFile"
  | "reset"
  | "subscribe"
>;

export type AppleIdentityControllerPort = Pick<
  AppleIdentityController,
  | "focusICloud"
  | "focusSignIn"
  | "cancelSignIn"
  | "cancelICloud"
  | "connectICloud"
  | "continueWithApple"
  | "detachIdentity"
  | "dispose"
  | "getState"
  | "replaceInvalidPassportFile"
  | "replaceUndecryptablePassportFile"
  | "reset"
  | "subscribe"
>;

export type LocalIdentityControllerPort = Pick<
  LocalIdentityController,
  | "createPubkyRingMigration"
  | "createRecoveryFile"
  | "listAuthorizedApps"
  | "listIdentities"
  | "removeIdentity"
  | "republishHomeserver"
  | "resolveHomeserver"
  | "revokeAuthorizedApp"
  | "selectIdentity"
  | "subscribeToIdentityChanges"
>;

export type PassportCollaborators = {
  createAuthorizationController?: () => AuthorizationControllerPort;
  createGoogleIdentityController: (
    googleClientId: string,
    homegateBaseUrl: string,
    forAuthorization?: boolean,
  ) => GoogleIdentityControllerPort;
  createAppleIdentityController: (
    configuration: AppleIdentityConfiguration,
  ) => AppleIdentityControllerPort;
  createLocalIdentityController: () => LocalIdentityControllerPort;
  IdentitySetup?: IdentitySetup;
};

const DEFAULT_PASSPORT_COLLABORATORS: PassportCollaborators = {
  createGoogleIdentityController: (googleClientId, homegateBaseUrl, forAuthorization) =>
    new GoogleIdentityController(
      googleClientId,
      homegateBaseUrl,
      undefined,
      undefined,
      forAuthorization ? new GoogleRedirectAuthorization(googleClientId) : undefined,
    ),
  createAppleIdentityController: (configuration) => new AppleIdentityController(configuration),
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
