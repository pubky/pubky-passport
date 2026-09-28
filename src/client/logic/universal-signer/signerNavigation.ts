import "client-only";

import type { LocalAccountDraft } from "@/client/logic/local-account/LocalAccountDraftRepository";
import type {
  LocalIdentityCatalog,
  LocalIdentityMetadata,
} from "@/client/logic/local-identity/localIdentityModels";

/** Where Back leaves identity addition; `null` means addition is the entry screen. */
export type AdditionOrigin = "switch" | "home" | null;

/** Screens that manage one identity. Detachment keeps the identity it started with. */
export type ManagementNavigation =
  | {
      view: "manage" | "recovery" | "ring" | "backup-to-google";
      publicKeyZ32: string;
      /** Manage and its backup screen belong to a logout in progress. */
      logout?: true;
    }
  | { view: "detach"; identity: LocalIdentityMetadata; googleSubject: string };

export type SignerNavigation =
  | { view: "home" | "switch" | "manual" }
  | { view: "add" | "import" | "create-account" | "connect-ring"; back: AdditionOrigin }
  | { view: "finish-add" | "profile"; publicKeyZ32: string }
  | { view: "external"; origin: { view: "home" } | { view: "add"; back: AdditionOrigin } }
  | ManagementNavigation;

export type SignerNavigationContext = {
  catalog: LocalIdentityCatalog;
  /** Keys whose required profile setup was put off for this session. */
  deferredProfiles: ReadonlySet<string>;
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
 * The active identity whose required profile setup is still due in this session. A Ring identity's
 * setup starts with Passport's own Ring request, which must not stand in front of an app's pending
 * request, so it waits until no request is under review.
 */
export function pendingProfileSetup({
  catalog,
  deferredProfiles,
  requestPending = false,
}: SignerNavigationContext): LocalIdentityMetadata | undefined {
  const active = catalog.activePublicKeyZ32
    ? findIdentity(catalog, catalog.activePublicKeyZ32)
    : undefined;
  if (!active?.profileSetupRequired) return undefined;
  if (deferredProfiles.has(active.publicIdentity.publicKeyZ32)) return undefined;
  return requestPending && active.keySource === "ring" ? undefined : active;
}

/**
 * The first screen. Due profile setup comes first. Only a submitted invite forces account setup
 * to resume, because its key may already own an account; unsubmitted setups wait until the person
 * opens account creation again. A submitted draft whose key is already saved finished registering.
 */
export function initialSignerNavigation(
  context: SignerNavigationContext,
  draft: LocalAccountDraft | null,
): SignerNavigation {
  const { catalog } = context;
  if (pendingProfileSetup(context)) return { view: "home" };
  if (draft?.registrationStarted && !findIdentity(catalog, draft.publicIdentity.publicKeyZ32))
    return { view: "create-account", back: catalog.identities.length ? "home" : null };
  // Chosen explicitly, so first-identity setup stays open after its identity is saved.
  if (catalog.identities.length === 0) return { view: "add", back: null };
  return { view: "home" };
}

/**
 * The screen to show for `navigation` in the current catalog, derived on every render. A screen
 * whose identity left the catalog falls back home. Home opens due profile setup, or identity
 * addition when nothing is saved. Detachment is never redirected. Returns `navigation` itself when
 * it needs no change.
 */
export function resolveSignerNavigation(
  navigation: SignerNavigation,
  context: SignerNavigationContext,
): SignerNavigation {
  if ("publicKeyZ32" in navigation && !findIdentity(context.catalog, navigation.publicKeyZ32))
    return resolveSignerNavigation({ view: "home" }, context);
  if (navigation.view !== "home") return navigation;
  const pending = pendingProfileSetup(context);
  if (pending) return { view: "profile", publicKeyZ32: pending.publicIdentity.publicKeyZ32 };
  if (context.catalog.identities.length === 0) return { view: "add", back: null };
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
