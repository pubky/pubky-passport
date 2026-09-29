"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";

import type { PassportAuthorizationController } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import { GoogleIdentityController } from "@/client/logic/google-identity/GoogleIdentityController";
import { HomegateAvailabilityClient } from "@/client/logic/homegate/HomegateAvailabilityClient";
import { HomegateSignupController } from "@/client/logic/homegate/HomegateSignupController";
import { HomegateVerificationClient } from "@/client/logic/homegate/HomegateVerificationClient";
import { InviteDestinationController } from "@/client/logic/local-account/InviteDestinationController";
import { LocalAccountDraftRepository } from "@/client/logic/local-account/LocalAccountDraftRepository";
import { readUnfinishedAccount } from "@/client/logic/local-account/unfinishedLocalAccount";
import { LocalIdentityController } from "@/client/logic/local-identity/LocalIdentityController";
import { ProfileController } from "@/client/logic/profile/ProfileController";
import { RingProfileController } from "@/client/logic/profile/RingProfileController";
import {
  SignupTokenChecker,
  type SignupTokenStatus,
} from "@/client/logic/pubky/SignupTokenChecker";
import type { HomeserverSignupDetails } from "@/client/logic/signup/homeserverInvite";

export type RingProfileControllerPort = Pick<
  RingProfileController,
  "start" | "poll" | "confirm" | "authorizationUrl" | "isConnected" | "save" | "dispose"
>;

/** The controller surface each screen consumes; fakes in `test-utils/` implement these ports. */
export type AuthorizationControllerPort = Pick<
  PassportAuthorizationController,
  | "approve"
  | "cancel"
  | "dispose"
  | "externalSignerUrl"
  | "finishExternalApproval"
  | "getState"
  | "subscribe"
>;

export type GoogleIdentityControllerPort = Pick<
  GoogleIdentityController,
  | "detachIdentity"
  | "backupIdentity"
  | "cancelAuthorization"
  | "continueBackupWithoutVisibleCopy"
  | "dispose"
  | "establishIdentity"
  | "continueWithoutVisibleBackup"
  | "getState"
  | "replaceInvalidPassportFile"
  | "replaceUndecryptablePassportFile"
  | "reset"
  | "showAuthorizationWindow"
  | "subscribe"
>;

export type LocalIdentityControllerPort = Pick<
  LocalIdentityController,
  | "createPubkyRingMigration"
  | "createRecoveryFile"
  | "listIdentities"
  | "removeIdentity"
  | "republishHomeserver"
  | "resolveHomeserver"
  | "selectIdentity"
  | "subscribeToIdentityChanges"
  | "verifyRecoveryFile"
>;

export type HomegateSignupControllerPort = Pick<
  HomegateSignupController,
  | "back"
  | "checkPayment"
  | "chooseSms"
  | "clearError"
  | "continueWithPhone"
  | "createInvoice"
  | "dispose"
  | "forget"
  | "getState"
  | "releaseInvite"
  | "sendSmsCode"
  | "start"
  | "subscribe"
  | "verifySmsCode"
>;

export type InviteDestinationControllerPort = Pick<
  InviteDestinationController,
  | "abandonPassport"
  | "chooseRing"
  | "choosePassport"
  | "closeInviteEntry"
  | "discardInvite"
  | "dispose"
  | "exit"
  | "getState"
  | "leavePassport"
  | "openInviteEntry"
  | "returnToChoice"
  | "submitInvite"
  | "subscribe"
>;

type SignupTokenCheck = (
  invite: HomeserverSignupDetails,
  signal: AbortSignal,
) => Promise<SignupTokenStatus>;

export type PassportCollaborators = {
  /** `httpRelay` is the instance's configured relay for Passport's own grant requests. */
  createRingProfileController: (httpRelay: string) => RingProfileControllerPort;
  createProfileController: () => Pick<ProfileController, "load" | "save" | "checkAvatar">;
  createAuthorizationController?: () => AuthorizationControllerPort;
  createGoogleIdentityController: (
    googleClientId: string,
    homegateBaseUrl: string,
  ) => GoogleIdentityControllerPort;
  createLocalIdentityController: () => LocalIdentityControllerPort;
  /** Reads the unfinished local account without changing storage. */
  readAccountDraft: () => ReturnType<LocalAccountDraftRepository["read"]>;
  /** Read-only invite lookup on the homeserver; resolves `unknown` instead of rejecting. */
  checkSignupToken: SignupTokenCheck;
  /** An empty base URL means this instance has no Homegate; requests then fail as unavailable. */
  createHomegateSignupController: (homegateBaseUrl: string) => HomegateSignupControllerPort;
  createHomegateAvailabilityClient: (
    homegateBaseUrl: string,
  ) => Pick<HomegateAvailabilityClient, "check">;
  /** Reads the unfinished account setup when called; one controller per account creation. */
  createInviteDestinationController: (
    checkSignupToken: SignupTokenCheck,
  ) => InviteDestinationControllerPort;
};

let signupTokenChecker: SignupTokenChecker | undefined;

const DEFAULT_PASSPORT_COLLABORATORS: PassportCollaborators = {
  createRingProfileController: (httpRelay) => new RingProfileController(httpRelay),
  createProfileController: () => new ProfileController(),
  createGoogleIdentityController: (googleClientId, homegateBaseUrl) =>
    new GoogleIdentityController(googleClientId, homegateBaseUrl),
  createLocalIdentityController: () => new LocalIdentityController(),
  readAccountDraft: () => new LocalAccountDraftRepository().read(),
  checkSignupToken: (invite, signal) => {
    signupTokenChecker ??= new SignupTokenChecker();
    return signupTokenChecker.check(invite, signal);
  },
  createHomegateSignupController: (homegateBaseUrl) =>
    new HomegateSignupController(
      homegateBaseUrl
        ? new HomegateVerificationClient(homegateBaseUrl, globalThis.fetch.bind(globalThis))
        : null,
    ),
  createHomegateAvailabilityClient: (homegateBaseUrl) =>
    new HomegateAvailabilityClient(homegateBaseUrl, globalThis.fetch.bind(globalThis)),
  createInviteDestinationController: (checkSignupToken) =>
    new InviteDestinationController(readUnfinishedAccount(), checkSignupToken),
};

const PassportCollaboratorsContext = createContext(DEFAULT_PASSPORT_COLLABORATORS);

/**
 * Supplies screen-scoped controller factories. Production pages omit this
 * provider and use the default constructors. Tests pass fakes instead of
 * mocking those module paths. Authorization has no default here: without an
 * override, `usePassportAuthorization` uses the page-scoped browser controller
 * built from the entry captured before hydration.
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
