/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { Keypair } from "@synonymdev/pubky";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityCatalog } from "@/client/logic/local-identity/localIdentityModels";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import { TEST_PROVIDER_HOMESERVER } from "@test-utils/instanceConfig";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { fakeLocalIdentityController } from "@test-utils/fakeLocalIdentityController";
import { mockGoogleIdentityController } from "@test-utils/mockGoogleIdentityController";
import { PubkyRingMigration } from "@/client/logic/pubky/PubkySdkAdapter";
import { UniversalSignerFlow } from "./universalSignerFlow";
import { fakePassportAuthorizationController } from "@test-utils/fakePassportAuthorizationController";

const FLOW = {
  catalog: { activePublicKeyZ32: null, identities: [] } as LocalIdentityCatalog,
  listener: undefined as (() => void) | undefined,
  establishIdentity: false,
  requireProfile: false,
  establishmentMode: "created" as "created" | "restored",
  migrationExportKeys: [] as string[],
  republished: [] as Array<[publicKeyZ32: string, homeserverPubky: string]>,
  storageUnavailable: false,
};

function renderSigner() {
  return render(
    withPassportTestProviders(<UniversalSignerFlow />, {
      createAuthorizationController: () =>
        fakePassportAuthorizationController({ current: { status: "manual-entry" } }),
      createLocalIdentityController: () =>
        fakeLocalIdentityController(FLOW, {
          createPubkyRingMigration: async (publicKeyZ32) => {
            FLOW.migrationExportKeys.push(publicKeyZ32);
            return Result.ok(
              new PubkyRingMigration(
                Keypair.fromSecret(Uint8Array.from({ length: 32 }, (_, index) => index)),
              ),
            );
          },
          republishHomeserver: async (publicKeyZ32, homeserverPubky) => {
            FLOW.republished.push([publicKeyZ32, homeserverPubky]);
            return Result.ok(homeserverPubky);
          },
        }),
      createGoogleIdentityController: () =>
        mockGoogleIdentityController({
          establishIdentity: async () => {
            if (FLOW.establishIdentity) {
              const identity = {
                publicIdentity: { publicKeyZ32: "created" },
                ...(FLOW.requireProfile ? { profileSetupRequired: true as const } : {}),
                googleAccount: {
                  googleSubject: "google-created",
                  email: "created@gmail.com",
                  name: "Created",
                  pictureUrl: null,
                },
              };
              FLOW.catalog = {
                activePublicKeyZ32: identity.publicIdentity.publicKeyZ32,
                identities: [identity],
              };
              FLOW.listener?.();
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
            const identities = FLOW.catalog.identities.map((identity) => {
              if (identity.publicIdentity.publicKeyZ32 !== publicIdentity.publicKeyZ32)
                return identity;
              const detached = { ...identity };
              delete detached.googleAccount;
              return detached;
            });
            FLOW.catalog = {
              activePublicKeyZ32: FLOW.catalog.activePublicKeyZ32,
              identities,
            };
            FLOW.listener?.();
            return Result.ok();
          },
        }),
    }),
  );
}

describe("UniversalSignerFlow identity navigation", () => {
  beforeEach(() => {
    FLOW.catalog = { activePublicKeyZ32: null, identities: [] };
    FLOW.listener = undefined;
    FLOW.establishIdentity = false;
    FLOW.requireProfile = false;
    FLOW.establishmentMode = "created";
    FLOW.migrationExportKeys = [];
    FLOW.republished = [];
    FLOW.storageUnavailable = false;
  });

  afterEach(() => {
    cleanup();
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    vi.clearAllMocks();
  });

  it("keeps Google backup completion visible until Continue, then requires profile setup", async () => {
    FLOW.establishIdentity = true;
    FLOW.requireProfile = true;
    const user = userEvent.setup();
    renderSigner();
    await user.click(await screen.findByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("heading", { name: "Backup ready." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Create your profile." })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("heading", { name: "Create your profile." }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("Name")).toHaveValue("Created");
    expect(screen.queryByRole("button", { name: "Authorize an app" })).not.toBeInTheDocument();
  });

  it("shows the landing page when no local identity exists", async () => {
    renderSigner();
    expect(
      await screen.findByRole("heading", { name: "Quick & easy signing." }),
    ).toBeInTheDocument();
  });

  it("offers to reload when local identity storage is unavailable", async () => {
    FLOW.storageUnavailable = true;
    renderSigner();

    expect(
      await screen.findByText("Passport could not read identities stored in this browser."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("keeps onboarding mounted until setup completion is acknowledged", async () => {
    FLOW.establishIdentity = true;
    renderSigner();

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Backup ready." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your pubky." })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  });

  it("returns to the overview directly after restoring an identity", async () => {
    FLOW.establishIdentity = true;
    FLOW.establishmentMode = "restored";
    renderSigner();

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Restore complete." })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  });

  it("routes a stored identity to the signed-in home state without borrowing its Google profile", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "identity",
      identities: [
        {
          publicIdentity: { publicKeyZ32: "identity" },
          googleAccount: {
            googleSubject: "google-1",
            email: "satoshi@gmail.com",
            name: "Satoshi Nakamoto",
            pictureUrl: null,
          },
        },
      ],
    };
    renderSigner();
    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    // Passport manages the Pubky profile; without profile.json the Google name is not used.
    expect(screen.getByRole("heading", { name: "Your Pubky" })).toBeInTheDocument();
    expect(screen.queryByText("Satoshi Nakamoto")).not.toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Attached Google account: satoshi@gmail.com" }),
    ).toHaveTextContent("satoshi@gmail.com");
    expect(screen.getByText("identity", { exact: true }).tagName).toBe("P");
    expect(screen.queryByRole("button", { name: "Copy Pubky" })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Copy Pubky")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage identity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Authorize an app" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download backup" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Quick & easy signing." }),
    ).not.toBeInTheDocument();
  });

  it("shows the active identity when several identities exist", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "second",
      identities: [
        { publicIdentity: { publicKeyZ32: "first" } },
        {
          publicIdentity: { publicKeyZ32: "second" },
          profile: { name: "Active Account" },
          googleAccount: {
            googleSubject: "google-2",
            email: "active@gmail.com",
            name: "Active Account",
            pictureUrl: null,
          },
        },
      ],
    };
    renderSigner();

    expect(await screen.findByText("Active Account")).toBeInTheDocument();
    expect(screen.getAllByText("second")[0]).toBeInTheDocument();
    expect(screen.queryByText("first")).not.toBeInTheDocument();
  });

  it("opens the switcher and sends Add identity to the signing flow", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "identity",
      identities: [{ publicIdentity: { publicKeyZ32: "identity" } }],
    };
    renderSigner();

    await userEvent.setup().click(await screen.findByRole("button", { name: "Switch identity" }));
    expect(screen.getByRole("heading", { name: "Switch identity." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Add identity" }));

    expect(
      await screen.findByRole("heading", { name: "Quick & easy signing." }),
    ).toBeInTheDocument();
  });

  it("gates a newly added identity behind setup completion", async () => {
    FLOW.establishIdentity = true;
    FLOW.catalog = {
      activePublicKeyZ32: "existing",
      identities: [{ publicIdentity: { publicKeyZ32: "existing" } }],
    };
    renderSigner();

    await userEvent.setup().click(await screen.findByRole("button", { name: "Switch identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Add identity" }));
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByRole("heading", { name: "Backup ready." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your pubky." })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    expect(screen.getAllByText("created")[0]).toBeInTheDocument();
  });

  it("selects the completed Google identity even if another tab changed selection", async () => {
    FLOW.establishIdentity = true;
    renderSigner();
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Continue with Google" }));
    await screen.findByRole("heading", { name: "Backup ready." });
    const created = FLOW.catalog.identities[0]!;
    act(() => {
      FLOW.catalog = {
        activePublicKeyZ32: "other",
        identities: [{ publicIdentity: { publicKeyZ32: "other" } }, created],
      };
      FLOW.listener?.();
    });
    expect(screen.getByRole("heading", { name: "Backup ready." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
    expect(FLOW.catalog.activePublicKeyZ32).toBe("created");
  });

  it("logs out only the active identity and activates a remaining identity", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "first",
      identities: [
        {
          publicIdentity: { publicKeyZ32: "first" },
          googleAccount: {
            googleSubject: "google-1",
            email: "first@gmail.com",
            name: "First",
            pictureUrl: null,
          },
        },
        {
          publicIdentity: { publicKeyZ32: "second" },
          profile: { name: "Second" },
          googleAccount: {
            googleSubject: "google-2",
            email: "second@gmail.com",
            name: "Second",
            pictureUrl: null,
          },
        },
      ],
    };
    renderSigner();

    await userEvent.setup().click(screen.getByRole("button", { name: "Manage identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Log out" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByText("Second")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  });

  it("opens recovery-file download from identity management", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "identity",
      identities: [{ publicIdentity: { publicKeyZ32: "identity" } }],
    };
    renderSigner();

    expect(screen.queryByRole("button", { name: "Detach from Google" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Manage identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Download backup" }));

    expect(screen.getByRole("heading", { name: "Encrypted backup." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Manage identity." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Detach from Google" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  });

  it.each([
    [
      "the provider homeserver to an identity that does not remember one",
      {},
      TEST_PROVIDER_HOMESERVER,
    ],
    [
      "only the homeserver an identity was signed up on",
      { homeserverPubky: "registered-homeserver" },
      "registered-homeserver",
    ],
  ])("republishes %s", async (_, stored, published) => {
    FLOW.catalog = {
      activePublicKeyZ32: "identity",
      identities: [{ publicIdentity: { publicKeyZ32: "identity" }, ...stored }],
    };
    const user = userEvent.setup();
    renderSigner();

    await user.click(screen.getByRole("button", { name: "Manage identity" }));
    await user.click(await screen.findByRole("button", { name: "Republish homeserver" }));
    expect(screen.getByRole("region", { name: /^Point this pubky/ })).toHaveTextContent(published);
    await user.click(screen.getByRole("button", { name: "Publish record" }));

    expect(await screen.findByText("Homeserver record republished.")).toBeInTheDocument();
    expect(FLOW.republished).toEqual([["identity", published]]);
  });

  it("exports the managed identity to Pubky Ring", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "active",
      identities: [
        { publicIdentity: { publicKeyZ32: "inactive" } },
        { publicIdentity: { publicKeyZ32: "active" } },
      ],
    };
    renderSigner();

    await userEvent.setup().click(screen.getByRole("button", { name: "Manage identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Use in Pubky Ring" }));

    expect(screen.getByRole("heading", { name: "Migrate to keychain." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(FLOW.migrationExportKeys).toEqual([]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR" }));
    expect(screen.getByRole("dialog", { name: "Scan with Pubky Ring" })).toBeInTheDocument();
    expect(FLOW.migrationExportKeys).toEqual(["active"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Manage identity." })).toBeInTheDocument();
  });

  it("secures recovery, confirms detachment, keeps the local identity, and shows completion", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "identity",
      identities: [
        {
          publicIdentity: { publicKeyZ32: "identity" },
          googleAccount: {
            googleSubject: "google",
            email: "user@gmail.com",
            name: "User",
            pictureUrl: null,
          },
        },
      ],
    };
    renderSigner();

    await userEvent.setup().click(screen.getByRole("button", { name: "Manage identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Detach from Google" }));

    expect(screen.getByRole("heading", { name: "Backup your pubky first." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Manage identity." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Detach from Google" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Migrate to keychain" }));
    expect(screen.getByRole("heading", { name: "Migrate to keychain." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(FLOW.migrationExportKeys).toEqual([]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR" }));
    expect(FLOW.migrationExportKeys).toEqual(["identity"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Backup your pubky first." })).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Download encrypted backup" }));
    expect(screen.getByRole("heading", { name: "Encrypted backup." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Backup your pubky first." })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "I backed up my pubky" }));
    expect(screen.getByRole("heading", { name: "Detach from Google." })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Remove Google Access" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Remove Google Access" }));
    const confirm = screen.getByRole("button", { name: "Confirm detachment" });
    expect(confirm).toBeDisabled();
    await userEvent.setup().type(screen.getByLabelText("Type DETACH to confirm"), "DETACH");
    expect(confirm).toBeEnabled();
    await userEvent.setup().click(confirm);

    expect((await screen.findByText("Detached")).closest("h1")).toBeInTheDocument();
    expect(FLOW.catalog.identities).toEqual([{ publicIdentity: { publicKeyZ32: "identity" } }]);
    expect(FLOW.catalog.activePublicKeyZ32).toBe("identity");
    await userEvent.setup().click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("button", { name: "Manage identity" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Manage identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Attach to Google" }));
    expect(screen.getByRole("heading", { name: "Attach to Google." })).toBeInTheDocument();
  });

  it("returns to onboarding when another tab removes the identity being managed", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "only",
      identities: [{ publicIdentity: { publicKeyZ32: "only" } }],
    };
    renderSigner();
    await userEvent.setup().click(screen.getByRole("button", { name: "Manage identity" }));
    expect(screen.getByRole("heading", { name: "Manage identity." })).toBeInTheDocument();

    act(() => {
      FLOW.catalog = { activePublicKeyZ32: null, identities: [] };
      FLOW.listener?.();
    });

    expect(
      await screen.findByRole("heading", { name: "Quick & easy signing." }),
    ).toBeInTheDocument();
  });

  it.each([
    ["Download backup", "Encrypted backup."],
    ["Use in Pubky Ring", "Migrate to keychain."],
    ["Attach to Google", "Attach to Google."],
  ])("leaves the %s screen when another tab removes its identity", async (action, heading) => {
    FLOW.catalog = {
      activePublicKeyZ32: "first",
      identities: [
        { publicIdentity: { publicKeyZ32: "first" } },
        { publicIdentity: { publicKeyZ32: "second" } },
      ],
    };
    const user = userEvent.setup();
    renderSigner();
    await user.click(screen.getByRole("button", { name: "Manage identity" }));
    await user.click(screen.getByRole("button", { name: action }));
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();

    act(() => {
      FLOW.catalog = {
        activePublicKeyZ32: "second",
        identities: [{ publicIdentity: { publicKeyZ32: "second" } }],
      };
      FLOW.listener?.();
    });

    expect(screen.queryByRole("heading", { name: heading })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your pubky." })).toBeInTheDocument();
  });

  it("returns to signed out when the last identity logs out", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "only",
      identities: [{ publicIdentity: { publicKeyZ32: "only" } }],
    };
    renderSigner();

    await userEvent.setup().click(screen.getByRole("button", { name: "Manage identity" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Log out" }));
    // A browser-only key without a Google backup must be acknowledged before deletion.
    expect(screen.getByRole("button", { name: "Log out" })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole("checkbox"));
    await userEvent.setup().click(screen.getByRole("button", { name: "Log out" }));

    expect(
      await screen.findByRole("heading", { name: "Quick & easy signing." }),
    ).toBeInTheDocument();
  });

  it("returns to the logout confirmation after the backup it asked for", async () => {
    FLOW.catalog = {
      activePublicKeyZ32: "only",
      identities: [{ publicIdentity: { publicKeyZ32: "only" } }],
    };
    const user = userEvent.setup();
    renderSigner();

    await user.click(screen.getByRole("button", { name: "Manage identity" }));
    await user.click(screen.getByRole("button", { name: "Log out" }));
    await user.click(screen.getByRole("button", { name: "Download backup" }));
    expect(screen.getByRole("heading", { name: "Encrypted backup." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("heading", { name: "Log out of this identity?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Download backup" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Manage identity." })).toBeInTheDocument();
  });
});
