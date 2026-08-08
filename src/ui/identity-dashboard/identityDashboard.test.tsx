/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PassportIdentityList } from "../../browser/identity/passportIdentity";
import { mockPassportIdentityController } from "../../../test-utils/fakes/mockPassportIdentityController";
import { IdentityDashboard } from "./identityDashboard";

const FLOW = vi.hoisted(() => ({
  catalog: { activeIdentityId: null, identities: [] } as PassportIdentityList,
  establishIdentity: false,
  migrationExportCount: 0,
  migrationUrl: "pubkyring://migrate?index=0&total=1&key=active-secret",
  refresh: null as (() => void) | null,
}));

vi.mock("../../browser/identity/passportIdentity", () => ({
  MIN_BACKUP_PASSWORD_LENGTH: 6,
  createPassportIdentityController: () => mockPassportIdentityController({
    continueGoogleBackedIdentityAction: async (action) => {
      if (action.kind === "establish_google_backed_identity" && FLOW.establishIdentity) {
        const identity = {
          id: "created",
          publicIdentity: { publicKeyZ32: "created", publicKeyDisplay: "pubkycreated" },
          googleAccount: { id: "google-created", email: "created@gmail.com", name: "Created", pictureUrl: null },
        };
        FLOW.catalog = { activeIdentityId: identity.id, identities: [identity] };
        FLOW.refresh?.();
        return {
          status: "action_completed" as const,
          result: Result.ok({
            kind: "google_backed_identity_established" as const,
            establishmentMode: "created" as const,
            publicIdentity: identity.publicIdentity,
            visibleRecoveryCopyStatus: "created" as const,
          }),
        };
      }
      if (action.kind !== "detach_google_backed_identity") return { status: "google_authorization_failed" as const };
      const identities = FLOW.catalog.identities.filter((identity) => identity.id !== action.publicIdentity.publicKeyZ32);
      FLOW.catalog = { activeIdentityId: identities[0]?.id ?? null, identities };
      FLOW.refresh?.();
      return {
        status: "action_completed" as const,
        result: Result.ok({ kind: "google_backed_identity_detached" as const, deletionStatus: "deleted" as const }),
      };
    },
    createPubkyRingMigrationUrl: () => {
      FLOW.migrationExportCount += 1;
      return Result.ok(FLOW.migrationUrl);
    },
    list: () => Result.ok(FLOW.catalog),
    prepareGoogleAuthorization: async (onState) => { onState({ stage: "google-authorization", errorCode: null }); },
    remove: (identityId: string) => {
      const identities = FLOW.catalog.identities.filter((identity) => identity.id !== identityId);
      FLOW.catalog = { activeIdentityId: identities[0]?.id ?? null, identities };
      FLOW.refresh?.();
      return Result.ok();
    },
    subscribe: (listener: () => void) => { FLOW.refresh = listener; return () => { FLOW.refresh = null; }; },
  }),
}));

describe("IdentityDashboard", () => {
  beforeEach(() => {
    FLOW.catalog = { activeIdentityId: null, identities: [] };
    FLOW.establishIdentity = false;
    FLOW.migrationExportCount = 0;
    FLOW.refresh = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the landing page when no local identity exists", async () => {
    render(<IdentityDashboard googleClientId="client" homegateBaseUrl="https://homegate.example/" />);
    expect(await screen.findByRole("heading", { name: "Quick & easy signing." })).toBeInTheDocument();
  });

  it("keeps onboarding mounted until setup completion is acknowledged", async () => {
    FLOW.establishIdentity = true;
    render(<IdentityDashboard googleClientId="client" homegateBaseUrl="https://homegate.example/" />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Setup complete." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your pubky." })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  });

  it("routes a stored identity to the signed-in home state", async () => {
    FLOW.catalog = { activeIdentityId: "identity", identities: [{ id: "identity", publicIdentity: { publicKeyZ32: "identity", publicKeyDisplay: "pubkyidentity" }, googleAccount: { id: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: null } }] };
    render(<IdentityDashboard googleClientId="client" homegateBaseUrl="https://homegate.example/" />);
    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    expect(screen.getByText("Satoshi Nakamoto")).toBeInTheDocument();
    expect(screen.getByText("identity")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Quick & easy signing." })).not.toBeInTheDocument();
  });

  it("shows the active identity when several identities exist", async () => {
    FLOW.catalog = {
      activeIdentityId: "second",
      identities: [
        { id: "first", publicIdentity: { publicKeyZ32: "first", publicKeyDisplay: "pubkyfirst" } },
        { id: "second", publicIdentity: { publicKeyZ32: "second", publicKeyDisplay: "pubkysecond" }, googleAccount: { id: "google-2", email: "active@gmail.com", name: "Active Account", pictureUrl: null } },
      ],
    };
    render(<IdentityDashboard googleClientId="client" homegateBaseUrl="https://homegate.example/" />);

    expect(await screen.findByText("Active Account")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(screen.queryByText("first")).not.toBeInTheDocument();
  });

  it("opens the switcher and sends Add identity to the signing flow", async () => {
    FLOW.catalog = { activeIdentityId: "identity", identities: [{ id: "identity", publicIdentity: { publicKeyZ32: "identity", publicKeyDisplay: "pubkyidentity" } }] };
    render(<IdentityDashboard googleClientId="client" homegateBaseUrl="https://homegate.example/" />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Switch" }));
    expect(screen.getByRole("heading", { name: "Switch identity." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Add identity" }));

    expect(await screen.findByRole("heading", { name: "Quick & easy signing." })).toBeInTheDocument();
  });

  it("logs out only the active identity and activates a remaining identity", async () => {
    FLOW.catalog = {
      activeIdentityId: "first",
      identities: [
        { id: "first", publicIdentity: { publicKeyZ32: "first", publicKeyDisplay: "pubkyfirst" }, googleAccount: { id: "google-1", email: "first@gmail.com", name: "First", pictureUrl: null } },
        { id: "second", publicIdentity: { publicKeyZ32: "second", publicKeyDisplay: "pubkysecond" }, googleAccount: { id: "google-2", email: "second@gmail.com", name: "Second", pictureUrl: null } },
      ],
    };
    render(<IdentityDashboard googleClientId="client" homegateBaseUrl="https://homegate.example/" />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Manage" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByText("Second")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  });

  it("opens encrypted backup from identity management", async () => {
    FLOW.catalog = { activeIdentityId: "identity", identities: [{ id: "identity", publicIdentity: { publicKeyZ32: "identity", publicKeyDisplay: "pubkyidentity" } }] };
    render(<IdentityDashboard googleClientId="client" homegateBaseUrl="https://homegate.example/" />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Manage" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Download backup" }));

    expect(screen.getByRole("heading", { name: "Encrypted backup." })).toBeInTheDocument();
  });

  it("exports only the active identity to Pubky Ring", async () => {
    FLOW.catalog = {
      activeIdentityId: "active",
      identities: [
        { id: "inactive", publicIdentity: { publicKeyZ32: "inactive", publicKeyDisplay: "pubkyinactive" } },
        { id: "active", publicIdentity: { publicKeyZ32: "active", publicKeyDisplay: "pubkyactive" } },
      ],
    };
    render(<IdentityDashboard googleClientId="client" homegateBaseUrl="https://homegate.example/" />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Manage" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Migrate to keychain" }));

    expect(screen.getByRole("heading", { name: "Migrate to keychain." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Import pubky" })).toHaveAttribute("href", FLOW.migrationUrl);
    expect(FLOW.migrationExportCount).toBe(1);
  });

  it("backs up, confirms detachment, clears the local identity, and shows completion", async () => {
    FLOW.catalog = { activeIdentityId: "identity", identities: [{ id: "identity", publicIdentity: { publicKeyZ32: "identity", publicKeyDisplay: "pubkyidentity" }, googleAccount: { id: "google", email: "user@gmail.com", name: "User", pictureUrl: null } }] };
    render(<IdentityDashboard googleClientId="client" homegateBaseUrl="https://homegate.example/" />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Manage" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Detach from Google" }));

    expect(screen.getByRole("heading", { name: "Backup your pubky first." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Migrate to keychain" }));
    expect(screen.getByRole("heading", { name: "Migrate to keychain." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Backup your pubky first." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Download encrypted backup" }));
    expect(screen.getByRole("heading", { name: "Encrypted backup." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Backup your pubky first." })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "I backed up my pubky" }));
    expect(screen.getByRole("heading", { name: "Detach from Google." })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Remove Google Access" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Remove Google Access" }));
    const confirm = screen.getByRole("button", { name: "Confirm deletion" });
    expect(confirm).toBeDisabled();
    await userEvent.setup().type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    expect(confirm).toBeEnabled();
    await userEvent.setup().click(confirm);

    expect(await screen.findByRole("heading", { name: "Detached from Google." })).toBeInTheDocument();
    expect(FLOW.catalog.identities).toEqual([]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("heading", { name: "Quick & easy signing." })).toBeInTheDocument();
  });

  it("returns to signed out when the last identity logs out", async () => {
    FLOW.catalog = { activeIdentityId: "only", identities: [{ id: "only", publicIdentity: { publicKeyZ32: "only", publicKeyDisplay: "pubkyonly" } }] };
    render(<IdentityDashboard googleClientId="client" homegateBaseUrl="https://homegate.example/" />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Manage" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("heading", { name: "Quick & easy signing." })).toBeInTheDocument();
  });
});
