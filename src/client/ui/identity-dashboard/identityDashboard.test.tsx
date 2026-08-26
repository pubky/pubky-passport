/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityService } from "../../logic/local-identity/LocalIdentityController";
import type { LocalIdentityCatalog } from "../../logic/local-identity/localIdentityModels";
import type { PubkyPublicIdentity } from "../../logic/pubky/pubkyIdentityKey";
import { withGoogleIdentityConfiguration } from "../../../../test-utils/googleIdentityConfiguration";
import { mockGoogleIdentityController } from "../../../../test-utils/mockGoogleIdentityController";
import { IdentityDashboard } from "./identityDashboard";

const FLOW = vi.hoisted(() => ({
  catalog: { activePublicKeyZ32: null, identities: [] } as LocalIdentityCatalog,
  catalogListener: undefined as (() => void) | undefined,
  establishIdentity: false,
  establishmentMode: "created" as "created" | "restored",
  migrationExportKeys: [] as string[],
  migrationUrl: "pubkyring://migrate?index=0&total=1&key=active-secret",
  storageUnavailable: false,
}));

function mockLocalIdentityController(
  overrides: Partial<LocalIdentityService> = {},
): LocalIdentityService {
  return {
    listIdentities: vi.fn(() => Result.ok({ activePublicKeyZ32: null, identities: [] })),
    selectIdentity: vi.fn(() => Result.ok()),
    removeIdentity: vi.fn(() => Result.ok()),
    subscribeToIdentityChanges: vi.fn(() => () => undefined),
    resolveHomeserver: vi.fn(async () => Result.ok(null)),
    createRecoveryFile: vi.fn(async () => Result.err({ code: "recovery_file_failed" as const })),
    createPubkyRingMigrationUrl: vi.fn(() => Result.err({ code: "invalid_identity" as const })),
    ...overrides,
  } satisfies LocalIdentityService;
}

vi.mock("../../logic/local-identity/LocalIdentityController", () => ({
  MINIMUM_RECOVERY_FILE_PASSWORD_CHARACTERS: 6,
  createLocalIdentityService: function createLocalIdentityService() {
    return mockLocalIdentityController({
      createPubkyRingMigrationUrl: (publicKeyZ32: string) => {
        FLOW.migrationExportKeys.push(publicKeyZ32);
        return Result.ok(FLOW.migrationUrl);
      },
      listIdentities: () => FLOW.storageUnavailable
        ? Result.err({ code: "storage_unavailable" as const })
        : Result.ok(FLOW.catalog),
      removeIdentity: (publicKeyZ32: string) => {
        const identities = FLOW.catalog.identities.filter(
          (identity) => identity.publicIdentity.publicKeyZ32 !== publicKeyZ32,
        );
        FLOW.catalog = { activePublicKeyZ32: identities[0]?.publicIdentity.publicKeyZ32 ?? null, identities };
        FLOW.catalogListener?.();
        return Result.ok();
      },
      selectIdentity: (publicKeyZ32: string) => {
        FLOW.catalog = { ...FLOW.catalog, activePublicKeyZ32: publicKeyZ32 };
        FLOW.catalogListener?.();
        return Result.ok();
      },
      subscribeToIdentityChanges: (listener: () => void) => {
        FLOW.catalogListener = listener;
        return () => { FLOW.catalogListener = undefined; };
      },
    });
  },
}));

vi.mock("../../logic/google-identity/GoogleIdentityController", () => ({
  createGoogleIdentitySession: function createGoogleIdentitySession() {
    return mockGoogleIdentityController({
      establishIdentity: async () => {
        if (FLOW.establishIdentity) {
          const identity = {
            publicIdentity: { publicKeyZ32: "created",},
            googleAccount: { googleSubject: "google-created", email: "created@gmail.com", name: "Created", pictureUrl: null },
          };
          FLOW.catalog = { activePublicKeyZ32: identity.publicIdentity.publicKeyZ32, identities: [identity] };
          FLOW.catalogListener?.();
          return Result.ok({
            establishmentMode: FLOW.establishmentMode,
            googleAccount: identity.googleAccount,
            publicIdentity: identity.publicIdentity,
            visibleRecoveryCopyStatus: "created" as const,
          });
        }
        return Result.err({ code: "authorization_failed" as const });
      },
      detachIdentity: async (publicIdentity: PubkyPublicIdentity) => {
        const identities = FLOW.catalog.identities.filter(
          (identity) => identity.publicIdentity.publicKeyZ32 !== publicIdentity.publicKeyZ32,
        );
        FLOW.catalog = { activePublicKeyZ32: identities[0]?.publicIdentity.publicKeyZ32 ?? null, identities };
        FLOW.catalogListener?.();
        return Result.ok();
      },
    });
  },
}));

function renderDashboard() {
  return render(withGoogleIdentityConfiguration(<IdentityDashboard />));
}

describe("IdentityDashboard", () => {
  beforeEach(() => {
    FLOW.catalog = { activePublicKeyZ32: null, identities: [] };
    FLOW.catalogListener = undefined;
    FLOW.establishIdentity = false;
    FLOW.establishmentMode = "created";
    FLOW.migrationExportKeys = [];
    FLOW.storageUnavailable = false;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the landing page when no local identity exists", async () => {
    renderDashboard();
    expect(await screen.findByRole("heading", { name: "Quick & easy signing." })).toBeInTheDocument();
  });

  it("offers to reload when local identity storage is unavailable", async () => {
    FLOW.storageUnavailable = true;
    renderDashboard();

    expect(await screen.findByText("Local identity storage is unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reload page" })).toHaveAttribute("href", "/");
  });

  it("keeps onboarding mounted until setup completion is acknowledged", async () => {
    FLOW.establishIdentity = true;
    renderDashboard();

    await userEvent.setup().click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Setup complete." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your pubky." })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  });

  it("keeps restored onboarding mounted until restore completion is acknowledged", async () => {
    FLOW.establishIdentity = true;
    FLOW.establishmentMode = "restored";
    renderDashboard();

    await userEvent.setup().click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Restore complete." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your pubky." })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  });

  it("routes a stored identity to the signed-in home state", async () => {
    FLOW.catalog = { activePublicKeyZ32: "identity", identities: [{ publicIdentity: { publicKeyZ32: "identity",}, googleAccount: { googleSubject: "google-1", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: null } }] };
    renderDashboard();
    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    expect(screen.getByText("Satoshi Nakamoto")).toBeInTheDocument();
    expect(screen.getByText("identity")).toHaveClass("normal-case");
    expect(screen.getByText("identity")).not.toHaveClass("uppercase");
    expect(screen.queryByRole("heading", { name: "Quick & easy signing." })).not.toBeInTheDocument();
  });

  it("shows the active identity when several identities exist", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "second",
      identities: [
        { publicIdentity: { publicKeyZ32: "first",} },
        { publicIdentity: { publicKeyZ32: "second",}, googleAccount: { googleSubject: "google-2", email: "active@gmail.com", name: "Active Account", pictureUrl: null } },
      ],
    };
    renderDashboard();

    expect(await screen.findByText("Active Account")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(screen.queryByText("first")).not.toBeInTheDocument();
  });

  it("opens the switcher and sends Add identity to the signing flow", async () => {
    FLOW.catalog = { activePublicKeyZ32: "identity", identities: [{ publicIdentity: { publicKeyZ32: "identity",} }] };
    renderDashboard();

    await userEvent.setup().click(await screen.findByRole("button", { name: "Switch" }));
    expect(screen.getByRole("heading", { name: "Switch identity." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Add identity" }));

    expect(await screen.findByRole("heading", { name: "Quick & easy signing." })).toBeInTheDocument();
  });

  it("gates a newly added identity behind setup completion", async () => {
    FLOW.establishIdentity = true;
    FLOW.catalog = {
      activePublicKeyZ32: "existing",
      identities: [{ publicIdentity: { publicKeyZ32: "existing",} }],
    };
    renderDashboard();

    await userEvent.setup().click(await screen.findByRole("button", { name: "Switch" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Add identity" }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Setup complete." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your pubky." })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    expect(screen.getByText("created")).toBeInTheDocument();
  });

  it("logs out only the active identity and activates a remaining identity", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "first",
      identities: [
        { publicIdentity: { publicKeyZ32: "first",}, googleAccount: { googleSubject: "google-1", email: "first@gmail.com", name: "First", pictureUrl: null } },
        { publicIdentity: { publicKeyZ32: "second",}, googleAccount: { googleSubject: "google-2", email: "second@gmail.com", name: "Second", pictureUrl: null } },
      ],
    };
    renderDashboard();

    await userEvent.setup().click(await screen.findByRole("button", { name: "Manage" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByText("Second")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  });

  it("opens recovery-file download from identity management", async () => {
    FLOW.catalog = { activePublicKeyZ32: "identity", identities: [{ publicIdentity: { publicKeyZ32: "identity",} }] };
    renderDashboard();

    await userEvent.setup().click(await screen.findByRole("button", { name: "Manage" }));
    expect(screen.queryByRole("button", { name: "Detach from Google" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Download recovery file" }));

    expect(screen.getByRole("heading", { name: "Encrypted backup." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Manage identity." })).toBeInTheDocument();
  });

  it("exports the managed identity to Pubky Ring", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "active",
      identities: [
        { publicIdentity: { publicKeyZ32: "inactive",} },
        { publicIdentity: { publicKeyZ32: "active",} },
      ],
    };
    renderDashboard();

    await userEvent.setup().click(await screen.findByRole("button", { name: "Manage" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Migrate to keychain" }));

    expect(screen.getByRole("heading", { name: "Migrate to keychain." })).toBeInTheDocument();
    expect(FLOW.migrationExportKeys).toEqual([]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR" }));
    expect(screen.getByRole("dialog", { name: "Scan with Pubky Ring" })).toBeInTheDocument();
    expect(FLOW.migrationExportKeys).toEqual(["active"]);
  });

  it("secures recovery, confirms detachment, clears the local identity, and shows completion", async () => {
    FLOW.catalog = { activePublicKeyZ32: "identity", identities: [{ publicIdentity: { publicKeyZ32: "identity",}, googleAccount: { googleSubject: "google", email: "user@gmail.com", name: "User", pictureUrl: null } }] };
    renderDashboard();

    await userEvent.setup().click(await screen.findByRole("button", { name: "Manage" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Detach from Google" }));

    expect(screen.getByRole("heading", { name: "Backup your pubky first." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Migrate to keychain" }));
    expect(screen.getByRole("heading", { name: "Migrate to keychain." })).toBeInTheDocument();
    expect(FLOW.migrationExportKeys).toEqual([]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR" }));
    expect(FLOW.migrationExportKeys).toEqual(["identity"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
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
    FLOW.catalog = { activePublicKeyZ32: "only", identities: [{ publicIdentity: { publicKeyZ32: "only",} }] };
    renderDashboard();

    await userEvent.setup().click(await screen.findByRole("button", { name: "Manage" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("heading", { name: "Quick & easy signing." })).toBeInTheDocument();
  });
});
