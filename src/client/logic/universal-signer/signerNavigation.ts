import "client-only";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import type { LocalAccountDraft } from "@/client/logic/local-account/LocalAccountDraftRepository";
import type {
  LocalIdentityCatalog,
  LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";

/**
 * Where Back leaves identity addition; `null` means addition is the entry screen. `choose` is the
 * identity list of an app's request.
 */
export type AdditionOrigin = "choose" | "switch" | "home" | null;

/**
 * Screens that manage one identity. Detachment keeps the identity and the Google account it
 * started with, since detaching removes that account from the saved identity.
 */
export type ManagementNavigation =
  | {
      view: "manage" | "ring" | "backup-to-google";
      publicKeyZ32: string;
      /** Manage and its backup screen belong to a logout in progress. */
      logout?: true;
    }
  | {
      view: "recovery";
      publicKeyZ32: string;
      /** The backup was asked for by a logout in progress and returns to it. */
      logout?: true;
      /** The backup was started from the overview and returns there. */
      home?: true;
      /** Only checks a backup file made earlier. */
      check?: true;
    }
  | { view: "detach"; identity: LocalIdentityMetadata; googleAccount: GoogleAccountProfile };

/**
 * Where the profile form was opened: right after an identity was added (`addition`), where
 * Skip for now goes on and there is no Back, or from the overview or Manage, where Back returns.
 */
export type ProfileOrigin = "addition" | "overview" | "manage";

/**
 * With an app's request, `choose` lists the identities to sign in with and `home` reviews the
 * request for the active one. Without a request, `home` is the active identity's overview and
 * `switch` changes it.
 */
export type SignerNavigation =
  | { view: "home" | "switch" | "manual" | "choose" }
  | { view: "add" | "import" | "create-account" | "connect-ring"; back: AdditionOrigin }
  | { view: "finish-add"; publicKeyZ32: string }
  | { view: "profile"; publicKeyZ32: string; from: ProfileOrigin }
  | {
      view: "external";
      origin: { view: "home" | "choose" } | { view: "add"; back: AdditionOrigin };
    }
  | ManagementNavigation;

export type SignerNavigationContext = {
  catalog: LocalIdentityCatalog;
  /** Whether an app's request is under review. */
  requestPending?: boolean | undefined;
};

export function findIdentity(
  catalog: LocalIdentityCatalog,
  publicKeyZ32: string,
): LocalIdentityMetadata | undefined {
  return catalog.identities.find(
    (identity) => identity.publicIdentity.publicKeyZ32 === publicKeyZ32,
  );
}

/**
 * The first screen. A request opens on its identity list. Only a submitted invite forces account
 * setup to resume, because its key may already own an account; unsubmitted setups wait until the
 * person opens account creation again. A submitted draft whose key is already saved finished
 * registering. Profile setup is never forced here: it follows account creation once, and is
 * offered afterwards from the overview and Manage.
 */
export function initialSignerNavigation(
  { catalog, requestPending = false }: SignerNavigationContext,
  draft: LocalAccountDraft | null,
): SignerNavigation {
  if (draft?.registrationStarted && !findIdentity(catalog, draft.publicIdentity.publicKeyZ32))
    return {
      view: "create-account",
      back: requestPending ? "choose" : catalog.identities.length ? "home" : null,
    };
  if (requestPending) return { view: "choose" };
  // Chosen explicitly, so first-identity setup stays open after its identity is saved.
  if (catalog.identities.length === 0) return { view: "add", back: null };
  return { view: "home" };
}

/**
 * The screen to show for `navigation` in the current catalog, derived on every render. A screen
 * whose identity left the catalog falls back home. With a request, home without an active
 * identity is the identity list, and the list replaces the switcher; without one, the list is
 * not offered and home opens identity addition when nothing is saved. Detachment is never
 * redirected. Returns `navigation` itself when it needs no change.
 */
export function resolveSignerNavigation(
  navigation: SignerNavigation,
  context: SignerNavigationContext,
): SignerNavigation {
  const { catalog, requestPending = false } = context;
  if ("publicKeyZ32" in navigation && !findIdentity(catalog, navigation.publicKeyZ32))
    return resolveSignerNavigation({ view: "home" }, context);
  if (requestPending) {
    if (navigation.view === "switch") return { view: "choose" };
    if (navigation.view !== "home") return navigation;
    const active = catalog.activePublicKeyZ32
      ? findIdentity(catalog, catalog.activePublicKeyZ32)
      : undefined;
    return active ? navigation : { view: "choose" };
  }
  if (navigation.view === "choose") return resolveSignerNavigation({ view: "home" }, context);
  if (navigation.view !== "home") return navigation;
  if (catalog.identities.length === 0) return { view: "add", back: null };
  return navigation;
}

/** Whether an added identity continues to profile setup; results may omit the saved flag. */
export function requiresProfileSetup(
  identity: LocalIdentityMetadata,
  catalog: LocalIdentityCatalog,
): boolean {
  return (
    identity.profileSetupRequired === true ||
    findIdentity(catalog, identity.publicIdentity.publicKeyZ32)?.profileSetupRequired === true
  );
}
