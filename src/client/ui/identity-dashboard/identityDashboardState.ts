"use client";

import type { LocalIdentityCatalog, LocalIdentityMetadata } from "../../browser/identity/passportIdentityController";

type IdentityDashboardState =
  | { view: "onboarding" }
  | { view: "overview" }
  | { view: "select-identity" }
  | { view: "manage-identity"; identityId: string }
  | { view: "encrypted-backup"; identityId: string }
  | { view: "migrate-to-pubky-ring"; identityId: string; migrationUrl: string | null }
  | { view: "detach-from-google"; identity: LocalIdentityMetadata };

type IdentityDashboardEvent =
  | { type: "onboarding-completed" }
  | { type: "switch-requested" }
  | { type: "identity-selected" }
  | { type: "manage-requested"; identityId: string }
  | { type: "backup-requested"; identityId: string }
  | { type: "migration-requested"; identityId: string; migrationUrl: string | null }
  | { type: "detachment-requested"; identity: LocalIdentityMetadata }
  | { type: "back-to-overview" }
  | { type: "back-to-management"; identityId: string }
  | { type: "identity-removed" };

function transitionIdentityDashboard(
  state: IdentityDashboardState,
  event: IdentityDashboardEvent,
): IdentityDashboardState {
  switch (event.type) {
    case "onboarding-completed":
      return state.view === "onboarding" ? { view: "overview" } : state;
    case "switch-requested":
      return state.view === "overview" ? { view: "select-identity" } : state;
    case "identity-selected":
    case "back-to-overview":
    case "identity-removed":
      return { view: "overview" };
    case "manage-requested":
      return state.view === "overview"
        ? { view: "manage-identity", identityId: event.identityId }
        : state;
    case "backup-requested":
      return state.view === "manage-identity"
        ? { view: "encrypted-backup", identityId: event.identityId }
        : state;
    case "migration-requested":
      return state.view === "manage-identity"
        ? { view: "migrate-to-pubky-ring", identityId: event.identityId, migrationUrl: event.migrationUrl }
        : state;
    case "detachment-requested":
      return state.view === "manage-identity"
        ? { view: "detach-from-google", identity: event.identity }
        : state;
    case "back-to-management":
      return state.view === "encrypted-backup"
        || state.view === "migrate-to-pubky-ring"
        || state.view === "detach-from-google"
        ? { view: "manage-identity", identityId: event.identityId }
        : state;
  }
}

function resolveIdentityDashboardState(
  state: IdentityDashboardState,
  catalog: LocalIdentityCatalog,
): IdentityDashboardState {
  if (state.view === "detach-from-google") return state;
  if (state.view === "onboarding") return state;
  if (catalog.identities.length === 0) return { view: "onboarding" };
  if ("identityId" in state
    && !catalog.identities.some((identity) => identity.id === state.identityId)) {
    return { view: "overview" };
  }
  return state;
}

function initialIdentityDashboardState(catalog: LocalIdentityCatalog): IdentityDashboardState {
  return catalog.identities.length === 0 ? { view: "onboarding" } : { view: "overview" };
}

export {
  initialIdentityDashboardState,
  resolveIdentityDashboardState,
  transitionIdentityDashboard,
  type IdentityDashboardEvent,
  type IdentityDashboardState,
};
