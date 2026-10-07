import "client-only";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import type { AuthorizationEntryScreen } from "@/client/logic/authorization/entry/authorizationEntry";
import type { SignupEntryMethod } from "@/client/logic/homegate/verificationMethods";
import type { LocalAccountDraft } from "@/client/logic/local-account/LocalAccountDraftRepository";
import type {
  LocalIdentityCatalog,
  LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";

/**
 * Where Back leaves identity addition; `null` means addition is the entry screen, as for an app's
 * request when nothing is saved. `choose` is the identity list of an app's request.
 */
export type AdditionOrigin = "choose" | "switch" | "home" | null;

/**
 * Screens that manage one identity whose key this browser holds: a key in Pubky Ring has none (its
 * overview holds its profile and its way out). Detachment keeps the identity and the Google
 * account it started with, since detaching removes that account from the saved identity.
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
    }
  /**
   * Verify your backup: a recovery file's check and Pubky Ring's, on one page. Opened from Manage
   * unless `from` says otherwise: the overview's backup warning (`home`), the removal confirmation
   * (`logout`, which Back returns to), or Migrate to Pubky Ring (`ring`), after which the page is
   * a step of its own that can be skipped.
   */
  | { view: "verify"; publicKeyZ32: string; from?: "home" | "logout" | "ring" }
  | { view: "detach"; identity: LocalIdentityMetadata; googleAccount: GoogleAccountProfile };

/**
 * Where the profile form was opened: right after an identity was added (`addition`), where
 * Skip for now goes on and there is no Back, from the overview or Manage, where Back returns,
 * for an app's request that needs a profile before its review (`request`), where Back returns to
 * the identity list and nothing skips it, for an app that holds a Session and waits for this
 * key's profile (`app`: its `profile-needed`, or `/#profile=<key>`), which ends on `profile-done`,
 * or from an app's edit link (`edit`: `/#edit-profile=<key>`), which leaves the page once saved.
 */
export type ProfileOrigin = "addition" | "overview" | "manage" | "request" | "app" | "edit";

/**
 * The start page's card an app's `entry=` points at when no saved identity can sign its request:
 * its Pubky Ring card (`sign-in`) or its Google button (`google`), which take focus.
 */
export type StartFocus = "ring" | "google";

/**
 * With an app's request, `choose` lists the identities to sign in with and `home` reviews the
 * request for the active one; with none that can sign it, the request starts on `add`, the start
 * page. Without a request, `home` is the active identity's overview and `switch` changes it.
 */
export type SignerNavigation =
  | { view: "home" | "switch" | "manual" | "choose" }
  | { view: "add"; back: AdditionOrigin; focus?: StartFocus | undefined }
  | { view: "import"; back: AdditionOrigin }
  /** `method` is the way to verify picked on the start page; without one the flow asks. */
  | { view: "create-account"; back: AdditionOrigin; method?: SignupEntryMethod | undefined }
  | { view: "finish-add"; publicKeyZ32: string }
  /** The profile an app waited for is published: back to the app (`told` when it heard of it). */
  | { view: "profile-done"; told: boolean }
  /** An edit link in any shape but `/#edit-profile=<key>`. */
  | { view: "edit-invalid" }
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

/**
 * The identities Passport can sign a request with: those whose key this browser holds. A key in
 * Pubky Ring signs only in Ring, so its identity is here for its profile alone; a request reaches
 * Ring through Continue with Pubky Ring, never through a saved Ring identity.
 */
export function signingIdentities(catalog: LocalIdentityCatalog): LocalIdentityMetadata[] {
  return catalog.identities.filter(({ keySource }) => keySource !== "ring");
}

/** The active identity, when Passport can sign a request with it. */
function activeSigningIdentity(catalog: LocalIdentityCatalog): LocalIdentityMetadata | undefined {
  const active = catalog.activePublicKeyZ32
    ? findIdentity(catalog, catalog.activePublicKeyZ32)
    : undefined;
  return active && active.keySource !== "ring" ? active : undefined;
}

/**
 * The identity to choose for an app's request before its first screen: the only one Passport can
 * sign it with, while another (a key in Pubky Ring) is the active one. `undefined` when the active
 * identity signs already, or when there is none or more than one to choose from.
 */
export function soleSigningIdentityToSelect(catalog: LocalIdentityCatalog): string | undefined {
  const signing = signingIdentities(catalog);
  return signing.length === 1 && !activeSigningIdentity(catalog)
    ? signing[0]?.publicIdentity.publicKeyZ32
    : undefined;
}

export function findIdentity(
  catalog: LocalIdentityCatalog,
  publicKeyZ32: string,
): LocalIdentityMetadata | undefined {
  return catalog.identities.find(
    (identity) => identity.publicIdentity.publicKeyZ32 === publicKeyZ32,
  );
}

/**
 * The first screen. A request opens on the identities that can sign it, whatever screen the app
 * asked for: straight on the active one's review when it is the only one (the shell chooses it
 * first, see {@link soleSigningIdentityToSelect}) or the request was entered from its overview
 * (`authorizingPublicKeyZ32`), else on their list; both offer the start page and Pubky Ring below.
 * With none that can sign, it opens on the start page, where the app's `entry` points: Join at
 * account creation's ways to verify (Back returns to the start page), Sign in at the Pubky Ring
 * card, Google at the Google button. Only a
 * submitted invite forces account setup to resume, because its key may already own an account;
 * unsubmitted setups wait until the person opens account creation again. A submitted draft whose
 * key is already saved finished registering. Profile setup is never forced here: it follows
 * account creation once, and is offered afterwards from the overview and Manage.
 */
export function initialSignerNavigation(
  { catalog, requestPending = false }: SignerNavigationContext,
  draft: LocalAccountDraft | null,
  authorizingPublicKeyZ32?: string | undefined,
  entry?: AuthorizationEntryScreen | undefined,
): SignerNavigation {
  // A request counts only the identities that can sign it; every other screen counts them all.
  const usable = requestPending ? signingIdentities(catalog) : catalog.identities;
  const saved = usable.length > 0;
  if (draft?.registrationStarted && !findIdentity(catalog, draft.publicIdentity.publicKeyZ32))
    return { view: "create-account", back: saved ? (requestPending ? "choose" : "home") : null };
  if (requestPending && saved) {
    // The only identity, or the one Authorize was pressed on, goes straight to the request's
    // review (Switch still leads to the list); otherwise the person picks one first.
    const active = activeSigningIdentity(catalog)?.publicIdentity.publicKeyZ32;
    return active !== undefined && (usable.length === 1 || active === authorizingPublicKeyZ32)
      ? { view: "home" }
      : { view: "choose" };
  }
  // Chosen explicitly, so first-identity setup stays open after its identity is saved. The screen
  // an app asked for counts only here, with none that can sign: never ahead of saved identities.
  if (!saved) {
    if (requestPending && entry === "join") return { view: "create-account", back: null };
    if (requestPending && (entry === "sign-in" || entry === "google"))
      return { view: "add", back: null, focus: entry === "google" ? "google" : "ring" };
    return { view: "add", back: null };
  }
  return { view: "home" };
}

/**
 * The screen to show for `navigation` in the current catalog, derived on every render. A screen
 * whose identity left the catalog falls back home. With a request, home without an active
 * identity that can sign is the identity list, and the list replaces the switcher; with no
 * identity that can sign, the start page stands in for the list. Without a request, the list is
 * not offered and home opens identity addition when nothing is saved. Detachment is never
 * redirected. Returns `navigation` itself when it needs no change.
 */
export function resolveSignerNavigation(
  navigation: SignerNavigation,
  context: SignerNavigationContext,
): SignerNavigation {
  const { catalog, requestPending = false } = context;
  // An app's profile setup, or its edit link, may name a key Passport has not saved yet: Ring
  // connects it, or the screen says it is not here.
  const appProfile =
    navigation.view === "profile" && (navigation.from === "app" || navigation.from === "edit");
  if (
    "publicKeyZ32" in navigation &&
    !appProfile &&
    !findIdentity(catalog, navigation.publicKeyZ32)
  )
    return resolveSignerNavigation({ view: "home" }, context);
  // Managing is for a key this browser holds; for a key in Pubky Ring every way there, a Back
  // included, leads to its overview instead.
  if (
    isManagementView(navigation) &&
    "publicKeyZ32" in navigation &&
    findIdentity(catalog, navigation.publicKeyZ32)?.keySource === "ring"
  )
    return resolveSignerNavigation({ view: "home" }, context);
  if (appProfile || navigation.view === "profile-done" || navigation.view === "edit-invalid")
    return navigation;
  if (requestPending) {
    if (navigation.view === "switch") return resolveSignerNavigation({ view: "choose" }, context);
    if (navigation.view === "choose")
      return signingIdentities(catalog).length ? navigation : { view: "add", back: null };
    if (navigation.view !== "home") return navigation;
    return activeSigningIdentity(catalog)
      ? navigation
      : resolveSignerNavigation({ view: "choose" }, context);
  }
  if (navigation.view === "choose") return resolveSignerNavigation({ view: "home" }, context);
  if (navigation.view !== "home") return navigation;
  if (catalog.identities.length === 0) return { view: "add", back: null };
  return navigation;
}

function isManagementView(navigation: SignerNavigation): navigation is ManagementNavigation {
  return MANAGEMENT_VIEWS.has(navigation.view);
}

const MANAGEMENT_VIEWS: ReadonlySet<SignerNavigation["view"]> = new Set<
  ManagementNavigation["view"]
>(["manage", "recovery", "ring", "verify", "backup-to-google", "detach"]);

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
