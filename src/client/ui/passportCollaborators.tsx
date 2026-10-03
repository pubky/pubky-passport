"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";

import type { PassportAuthorizationController } from "@/client/logic/authorization/flow/PassportAuthorizationController";
import { GoogleIdentityController } from "@/client/logic/google-identity/GoogleIdentityController";
import { GoogleRedirectAuthorization } from "@/client/logic/google-identity/gia/GoogleRedirectAuthorization";
import {
  isGoogleRedirectReturn,
  returnToAuthorization,
} from "@/client/logic/google-identity/gia/googleRedirectBootstrap";
import { HomegateAvailabilityClient } from "@/client/logic/homegate/HomegateAvailabilityClient";
import { HomegateSignupController } from "@/client/logic/homegate/HomegateSignupController";
import { HomegateVerificationClient } from "@/client/logic/homegate/HomegateVerificationClient";
import { InviteDestinationController } from "@/client/logic/local-account/InviteDestinationController";
import { LocalAccountDraftRepository } from "@/client/logic/local-account/LocalAccountDraftRepository";
import { takeAuthorizeFromIdentity } from "@/client/logic/universal-signer/authorizeFromIdentity";
import { readUnfinishedAccount } from "@/client/logic/local-account/unfinishedLocalAccount";
import { LocalIdentityController } from "@/client/logic/local-identity/LocalIdentityController";
import { ProfileController } from "@/client/logic/profile/ProfileController";
import { RingProfileController } from "@/client/logic/profile/RingProfileController";
import { RingBackupVerifier } from "@/client/logic/backup/RingBackupVerifier";
import {
  SignupTokenChecker,
  type SignupTokenStatus,
} from "@/client/logic/pubky/SignupTokenChecker";
import type { HomeserverSignupDetails } from "@/client/logic/signup/homeserverInvite";

export type RingBackupVerifierPort = Pick<
  RingBackupVerifier,
  "start" | "poll" | "authorizationUrl" | "dispose"
>;

export type RingProfileControllerPort = Pick<
  RingProfileController,
  "start" | "poll" | "confirm" | "authorizationUrl" | "isConnected" | "save" | "dispose"
>;

/** The controller surface each screen consumes; fakes in `test-utils/` implement these ports. */
export type AuthorizationControllerPort = Pick<
  PassportAuthorizationController,
  | "approve"
  | "canWatchExternalApproval"
  | "cancel"
  | "dispose"
  | "externalSignerUrl"
  | "reportPhase"
  | "leaveExternalSigner"
  | "getState"
  | "subscribe"
  | "watchExternalApproval"
  | "profileNeeded"
  | "profileReady"
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
  | "rememberProfileNeeded"
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
  | "dismissRefusal"
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
  /** `httpRelay` as above; one verifier per check that Pubky Ring holds a key saved here. */
  createRingBackupVerifier: (httpRelay: string) => RingBackupVerifierPort;
  createProfileController: () => Pick<ProfileController, "load" | "save" | "checkAvatar">;
  createAuthorizationController?: () => AuthorizationControllerPort;
  createGoogleIdentityController: (
    googleClientId: string,
    homegateBaseUrl: string,
    /**
     * For a waiting request: Google still opens in its pop-up, and continues in this window only
     * when the browser blocks the pop-up.
     */
    forAuthorization?: boolean,
  ) => GoogleIdentityControllerPort;
  createLocalIdentityController: () => LocalIdentityControllerPort;
  /** Reads the unfinished local account without changing storage. */
  readAccountDraft: () => ReturnType<LocalAccountDraftRepository["read"]>;
  /** The identity whose overview's Authorize led to this page load, if any; read once. */
  takeAuthorizeFromIdentity: () => string | undefined;
  /**
   * The Google sign-in in this window for a waiting request: whether this page is the one Google
   * returned to, and the way back to the page the request entered at (false when the request is
   * gone and there is nowhere to return to).
   */
  googleRedirect: { isReturn: () => boolean; returnToAuthorization: () => boolean };
  /** Read-only invite lookup on the homeserver; resolves `unknown` instead of rejecting. */
  checkSignupToken: SignupTokenCheck;
  /** Whether a homeserver answers, by a read-only lookup; resolves `false` instead of rejecting. */
  checkHomeserver: (homeserverPubky: string, signal: AbortSignal) => Promise<boolean>;
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
  createRingBackupVerifier: (httpRelay) => new RingBackupVerifier(httpRelay),
  createProfileController: () => new ProfileController(),
  createGoogleIdentityController: (googleClientId, homegateBaseUrl, forAuthorization) =>
    new GoogleIdentityController(
      googleClientId,
      homegateBaseUrl,
      undefined,
      undefined,
      // An identity established for a waiting request may continue in this window, when the
      // browser blocks Google's pop-up.
      forAuthorization ? new GoogleRedirectAuthorization(googleClientId) : undefined,
    ),
  createLocalIdentityController: () => new LocalIdentityController(),
  readAccountDraft: () => new LocalAccountDraftRepository().read(),
  takeAuthorizeFromIdentity: () => takeAuthorizeFromIdentity(),
  googleRedirect: {
    isReturn: isGoogleRedirectReturn,
    returnToAuthorization: () => returnToAuthorization(),
  },
  checkSignupToken: (invite, signal) => {
    signupTokenChecker ??= new SignupTokenChecker();
    return signupTokenChecker.check(invite, signal);
  },
  checkHomeserver: (homeserverPubky, signal) => {
    signupTokenChecker ??= new SignupTokenChecker();
    return signupTokenChecker.reaches(homeserverPubky, signal);
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
