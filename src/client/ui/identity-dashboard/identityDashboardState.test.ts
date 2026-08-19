import { describe, expect, it } from "vitest";

import { resolveIdentityDashboardState, transitionIdentityDashboard } from "./identityDashboardState";

const IDENTITY = { publicIdentity: { publicKeyDisplay: "pubkyidentity", publicKeyZ32: "identity" } };
const CATALOG = { activePublicKeyZ32: IDENTITY.publicIdentity.publicKeyZ32, identities: [IDENTITY] };

describe("identity dashboard state", () => {
  it("navigates through selection and management", () => {
    expect(transitionIdentityDashboard({ view: "overview" }, { type: "switch-requested" }))
      .toEqual({ view: "select-identity" });
    expect(transitionIdentityDashboard({ view: "select-identity" }, { type: "identity-selected" }))
      .toEqual({ view: "overview" });
    expect(transitionIdentityDashboard({ view: "overview" }, {
      type: "manage-requested",
      publicKeyZ32: IDENTITY.publicIdentity.publicKeyZ32,
    })).toEqual({ view: "manage-identity", publicKeyZ32: IDENTITY.publicIdentity.publicKeyZ32 });
  });

  it("preserves the explicit target and return path of management subflows", () => {
    const publicKeyZ32 = IDENTITY.publicIdentity.publicKeyZ32;
    const management = { view: "manage-identity", publicKeyZ32 } as const;
    const backup = transitionIdentityDashboard(management, { type: "backup-requested", publicKeyZ32 });
    expect(backup).toEqual({ view: "encrypted-backup", publicKeyZ32 });
    expect(transitionIdentityDashboard(backup, { type: "back-to-management", publicKeyZ32 }))
      .toEqual(management);
    expect(transitionIdentityDashboard(management, { type: "detachment-requested", identity: IDENTITY }))
      .toEqual({ view: "detach-from-google", identity: IDENTITY });
  });

  it("starts onboarding for an empty catalog", () => {
    expect(resolveIdentityDashboardState({ view: "overview" }, { activePublicKeyZ32: null, identities: [] }))
      .toEqual({ view: "onboarding" });
    expect(resolveIdentityDashboardState({ view: "select-identity" }, CATALOG))
      .toEqual({ view: "select-identity" });
  });

  it("keeps onboarding mounted after the new identity enters the catalog", () => {
    expect(resolveIdentityDashboardState({ view: "onboarding" }, CATALOG))
      .toEqual({ view: "onboarding" });
    expect(transitionIdentityDashboard({ view: "onboarding" }, { type: "onboarding-completed" }))
      .toEqual({ view: "overview" });
  });

  it("keeps an in-progress detachment mounted after its identity is removed", () => {
    const detachment = { view: "detach-from-google", identity: IDENTITY } as const;
    expect(resolveIdentityDashboardState(detachment, { activePublicKeyZ32: null, identities: [] }))
      .toBe(detachment);
  });
});
